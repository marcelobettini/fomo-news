import { MongoClient, ObjectId, type Db } from "mongodb";
import type { MappedNews } from "../core/mapEntry.js";
import type { KnownNews } from "../core/dedup.js";
import type { AlarmCode } from "../core/alarms.js";

export interface RepositoryHandle {
  db: Db;
  close(): Promise<void>;
}

/** Ciclo de vida de conexión a MongoDB; sin ORM, driver oficial. */
export async function connect(mongoUri: string): Promise<RepositoryHandle> {
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();
  return {
    db,
    close: () => client.close(),
  };
}

/** Forma persistida de una noticia; añade bookkeeping interno sobre los campos de MappedNews. */
export interface NewsDocument {
  _id: string;
  title: string;
  summary: string;
  link: string;
  category: string;
  publishedAt: Date;
  updatedAt: Date;
  firstSeenAt: Date;
  expiresAt: Date;
}

const NEWS_COLLECTION = "news";

/**
 * Índice TTL sobre `expiresAt`: la purga la hace el motor de MongoDB, sin código propio
 * (research.md §11). EXCEPCIÓN DE ARTÍCULO I DOCUMENTADA (ver plan.md Complexity Tracking):
 * este TTL purga por calendario sin saber si la noticia fue entregada, porque este feature
 * no incluye notificador ni suscriptores todavía. Cuando exista la feature de notificaciones,
 * esta purga DEBE revisarse para no eliminar noticias no entregadas.
 */
export async function ensureNewsIndexes(db: Db): Promise<void> {
  await db
    .collection<NewsDocument>(NEWS_COLLECTION)
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

/** Trae solo los campos necesarios para decidir novedad/actualización (research.md §5). */
export async function getKnownNewsForLinks(
  db: Db,
  links: readonly string[],
): Promise<Map<string, KnownNews>> {
  if (links.length === 0) return new Map();
  const docs = await db
    .collection<NewsDocument>(NEWS_COLLECTION)
    .find(
      { _id: { $in: [...links] } },
      { projection: { title: 1, summary: 1, category: 1, updatedAt: 1 } },
    )
    .toArray();
  return new Map(
    docs.map((doc) => [
      doc._id,
      { title: doc.title, summary: doc.summary, category: doc.category, updatedAt: doc.updatedAt },
    ]),
  );
}

/**
 * Upsert por enlace (`_id`). Devuelve `true` si fue una inserción nueva (la entrada no
 * existía todavía), `false` si actualizó una noticia ya conocida.
 */
export async function upsertNews(db: Db, record: MappedNews, now: Date): Promise<boolean> {
  const result = await db.collection<NewsDocument>(NEWS_COLLECTION).updateOne(
    { _id: record.link },
    {
      $set: {
        title: record.title,
        summary: record.summary,
        link: record.link,
        category: record.category,
        publishedAt: record.publishedAt,
        updatedAt: record.updatedAt,
        expiresAt: record.expiresAt,
      },
      $setOnInsert: { firstSeenAt: now },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0;
}

/**
 * Noticias publicadas después de `sinceInstant`, de más reciente a más antigua — usado por el
 * resumen periódico de noticias (feature 004) para acotar la lectura a la ventana de antigüedad
 * máxima configurada, antes de evaluar elegibilidad por suscriptor (data-model.md de
 * specs/004-send-email-news/). La categoría ya viene acotada: `news` solo contiene la
 * categoría objetivo (el ingestor filtra antes de escribir).
 */
export async function getNewsPublishedAfter(db: Db, sinceInstant: Date): Promise<NewsDocument[]> {
  return db
    .collection<NewsDocument>(NEWS_COLLECTION)
    .find({ publishedAt: { $gt: sinceInstant } })
    .sort({ publishedAt: -1 })
    .toArray();
}

/** Categoría vista alguna vez en la fuente, objetivo o no (FR-012). */
export interface CategoryDocument {
  _id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

const CATEGORIES_COLLECTION = "categories";

/** Registra cada categoría vista en esta corrida; devuelve las que nunca se habían visto (FR-015). */
export async function upsertCategoriesSeen(
  db: Db,
  categories: readonly string[],
  now: Date,
): Promise<string[]> {
  const newlySeen: string[] = [];
  for (const category of new Set(categories)) {
    if (!category) continue;
    const result = await db.collection<CategoryDocument>(CATEGORIES_COLLECTION).updateOne(
      { _id: category },
      { $set: { lastSeenAt: now }, $setOnInsert: { firstSeenAt: now } },
      { upsert: true },
    );
    if (result.upsertedCount > 0) newlySeen.push(category);
  }
  return newlySeen;
}

/** Documento singleton de bookkeeping técnico (no es una entidad de negocio, ver data-model.md). */
export interface StateDocument {
  _id: "ingestor";
  lastTargetCategoryObservedAt?: Date;
}

const STATE_ID = "ingestor" as const;

export async function getLastTargetCategoryObservedAt(db: Db): Promise<Date | null> {
  const state = await db.collection<StateDocument>("state").findOne({ _id: STATE_ID });
  return state?.lastTargetCategoryObservedAt ?? null;
}

export async function touchTargetCategoryObserved(db: Db, now: Date): Promise<void> {
  await db
    .collection<StateDocument>("state")
    .updateOne({ _id: STATE_ID }, { $set: { lastTargetCategoryObservedAt: now } }, { upsert: true });
}

export interface RunDocument {
  _id: ObjectId;
  startedAt: Date;
  finishedAt: Date;
  status: "success" | "failure";
  entriesSeen: number;
  entriesNew: number;
  oldestEntryAt: Date | null;
  errors: string[];
  alarms: AlarmCode[];
  newCategoriesObserved: string[];
  categoryMismatches: number;
}

const RUNS_COLLECTION = "runs";

export async function recordRun(db: Db, run: Omit<RunDocument, "_id">): Promise<ObjectId> {
  const _id = new ObjectId();
  await db.collection<RunDocument>(RUNS_COLLECTION).insertOne({ _id, ...run });
  return _id;
}

/** FR-013: excepción de la alarma de rotación completa en la primera corrida de la vida del sistema. */
export async function hasPriorSuccessfulRun(db: Db): Promise<boolean> {
  const found = await db.collection<RunDocument>(RUNS_COLLECTION).findOne({ status: "success" });
  return found !== null;
}

export interface RawSnapshotDocument {
  _id: ObjectId;
  runId: ObjectId;
  fetchedAt: Date;
  rawBody: string;
  expiresAt: Date;
}

const RAW_SNAPSHOTS_COLLECTION = "raw_snapshots";

/** TTL corto e independiente del de `news` — solo para diagnóstico (FR-020). */
export async function ensureRawSnapshotIndexes(db: Db): Promise<void> {
  await db
    .collection<RawSnapshotDocument>(RAW_SNAPSHOTS_COLLECTION)
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function saveRawSnapshot(
  db: Db,
  snapshot: { runId: ObjectId; fetchedAt: Date; rawBody: string; retentionMs: number },
): Promise<void> {
  await db.collection<RawSnapshotDocument>(RAW_SNAPSHOTS_COLLECTION).insertOne({
    _id: new ObjectId(),
    runId: snapshot.runId,
    fetchedAt: snapshot.fetchedAt,
    rawBody: snapshot.rawBody,
    expiresAt: new Date(snapshot.fetchedAt.getTime() + snapshot.retentionMs),
  });
}
