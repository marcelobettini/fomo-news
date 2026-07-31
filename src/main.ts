import { loadEnvConfig } from "./config/env.js";
import {
  connect,
  ensureNewsIndexes,
  ensureRawSnapshotIndexes,
  getKnownNewsForLinks,
  upsertNews,
  upsertCategoriesSeen,
  touchTargetCategoryObserved,
  getLastTargetCategoryObservedAt,
  hasPriorSuccessfulRun,
  recordRun,
  saveRawSnapshot,
} from "./adapters/repository.js";
import { acquireLock, releaseLock, ensureLockIndexes } from "./adapters/lock.js";
import { fetchRawFeedBody, parseAtomFeed, type ParsedFeed } from "./adapters/source.js";
import { mapEntryToNews, detectCategoryMismatch } from "./core/mapEntry.js";
import { decideDedup } from "./core/dedup.js";
import { evaluateAlarms, determineRunStatus } from "./core/alarms.js";

async function run(): Promise<void> {
  const config = loadEnvConfig();
  const repo = await connect(config.mongoUri);
  try {
    await ensureLockIndexes(repo.db);
    await ensureNewsIndexes(repo.db);
    await ensureRawSnapshotIndexes(repo.db);

    const acquired = await acquireLock(repo.db, "ingestor");
    if (!acquired) {
      // Corrida omitida por exclusión mutua: no es un fallo (contracts/cli-contract.md).
      console.error("Ya hay una corrida en curso; esta invocación se omite.");
      return;
    }
    try {
      await executeRun(repo.db, config);
    } finally {
      await releaseLock(repo.db, "ingestor");
    }
  } finally {
    await repo.close();
  }
}

async function executeRun(
  db: Awaited<ReturnType<typeof connect>>["db"],
  config: Awaited<ReturnType<typeof loadEnvConfig>>,
): Promise<void> {
  const startedAt = new Date();
  const targetCategory = config.targetCategory.trim();

  let rawBody: string | null = null;
  let fetchedAt = new Date();
  let feed: ParsedFeed | null = null;
  let fetchError: string | null = null;
  try {
    const fetched = await fetchRawFeedBody(config.sourceFeedUrl);
    rawBody = fetched.rawBody;
    fetchedAt = fetched.fetchedAt;
    feed = parseAtomFeed(rawBody);
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
  }

  if (!feed || rawBody === null) {
    await recordRun(db, {
      startedAt,
      finishedAt: new Date(),
      status: "failure",
      entriesSeen: 0,
      entriesNew: 0,
      oldestEntryAt: null,
      errors: [fetchError ?? "Error desconocido al descargar/parsear la fuente"],
      alarms: [],
      newCategoriesObserved: [],
      categoryMismatches: 0,
    });
    throw new Error(fetchError ?? "La fuente no respondió de forma válida");
  }

  const allMapped = feed.entries.map((entry) => ({
    raw: entry,
    mapped: mapEntryToNews(entry, config.newsRetentionMs),
  }));
  const kept = allMapped.filter(({ mapped }) => mapped.category === targetCategory);

  const knownNews = await getKnownNewsForLinks(
    db,
    kept.map(({ mapped }) => mapped.link),
  );
  const decisions = decideDedup(
    kept.map(({ mapped }) => mapped),
    knownNews,
  );
  for (const { entry } of decisions) {
    await upsertNews(db, entry, startedAt);
  }

  const entriesSeen = feed.totalEntriesInFeed;
  const entriesNew = decisions.filter((decision) => decision.decision === "new").length;
  const categoryMismatches = kept.filter(({ raw }) => detectCategoryMismatch(raw)).length;

  const newCategoriesObserved = await upsertCategoriesSeen(
    db,
    allMapped.map(({ mapped }) => mapped.category),
    startedAt,
  );

  if (kept.length > 0) {
    await touchTargetCategoryObserved(db, startedAt);
  }
  const lastTargetCategoryObservedAt = await getLastTargetCategoryObservedAt(db);
  const priorSuccess = await hasPriorSuccessfulRun(db);

  const alarms = evaluateAlarms({
    entriesSeen,
    entriesNew,
    hasPriorSuccessfulRun: priorSuccess,
    now: startedAt,
    lastTargetCategoryObservedAt,
    categorySilenceThresholdMs: config.categorySilenceThresholdMs,
  });

  const oldestEntryAt =
    feed.entries.length > 0
      ? new Date(Math.min(...feed.entries.map((entry) => entry.publishedAt.getTime())))
      : null;

  const status = determineRunStatus(entriesSeen, false);

  const runId = await recordRun(db, {
    startedAt,
    finishedAt: new Date(),
    status,
    entriesSeen,
    entriesNew,
    oldestEntryAt,
    errors: feed.entryErrors,
    alarms,
    newCategoriesObserved,
    categoryMismatches,
  });

  await saveRawSnapshot(db, {
    runId,
    fetchedAt,
    rawBody,
    retentionMs: config.rawSnapshotRetentionMs,
  });

  if (status === "failure" || alarms.length > 0) {
    throw new Error(
      `Corrida con problemas: status=${status} alarms=[${alarms.join(", ")}] errors=[${feed.entryErrors.join("; ")}]`,
    );
  }

  console.error(
    `Corrida OK: entriesSeen=${entriesSeen} entriesNew=${entriesNew} categoryMismatches=${categoryMismatches} newCategories=[${newCategoriesObserved.join(", ")}]`,
  );
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    console.error("La corrida falló:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
