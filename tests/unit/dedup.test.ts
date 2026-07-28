import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { mapEntryToNews } from "../../src/core/mapEntry.js";
import { decideDedup, type KnownNews } from "../../src/core/dedup.js";
import { readFixture } from "./testHelpers.js";

const TEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

test("distingue inserción (nueva) cuando no hay estado previo", () => {
  const entries = parseAtomFeed(readFixture("normal.xml")).entries.map((entry) => mapEntryToNews(entry, TEST_RETENTION_MS));

  const decisions = decideDedup(entries, new Map());

  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((d) => d.decision === "new"));
});

test("distingue actualización (ya conocida, contenido cambiado)", () => {
  const original = parseAtomFeed(readFixture("normal.xml")).entries.map((entry) => mapEntryToNews(entry, TEST_RETENTION_MS))[0];
  assert.ok(original);
  const updated = parseAtomFeed(readFixture("updated-entry.xml")).entries.map((entry) => mapEntryToNews(entry, TEST_RETENTION_MS))[0];
  assert.ok(updated);

  const known = new Map<string, KnownNews>([
    [
      original.link,
      {
        title: original.title,
        summary: original.summary,
        category: original.category,
        updatedAt: original.updatedAt,
      },
    ],
  ]);

  const [decision] = decideDedup([updated], known);

  assert.equal(decision?.decision, "updated");
});

test("distingue no-op cuando el contenido no cambió (repetir la misma corrida)", () => {
  const entries = parseAtomFeed(readFixture("normal.xml")).entries.map((entry) => mapEntryToNews(entry, TEST_RETENTION_MS));
  const known = new Map<string, KnownNews>(
    entries.map((entry) => [
      entry.link,
      { title: entry.title, summary: entry.summary, category: entry.category, updatedAt: entry.updatedAt },
    ]),
  );

  const decisions = decideDedup(entries, known);

  assert.ok(decisions.every((d) => d.decision === "unchanged"));
});
