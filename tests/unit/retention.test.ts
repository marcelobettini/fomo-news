import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { mapEntryToNews } from "../../src/core/mapEntry.js";
import { readFixture } from "./testHelpers.js";

test("expiresAt se calcula como publishedAt + retención configurada (FR-008)", () => {
  const [entry] = parseAtomFeed(readFixture("normal.xml")).entries;
  assert.ok(entry);
  const retentionMs = 3 * 24 * 60 * 60 * 1000; // 3 días, valor arbitrario de test

  const mapped = mapEntryToNews(entry, retentionMs);

  assert.equal(mapped.expiresAt.getTime(), entry.publishedAt.getTime() + retentionMs);
});

test("dos noticias con distinta publishedAt pero misma retención tienen expiresAt desplazado igual", () => {
  const entries = parseAtomFeed(readFixture("normal.xml")).entries;
  const retentionMs = 7 * 24 * 60 * 60 * 1000;

  const mapped = entries.map((entry) => mapEntryToNews(entry, retentionMs));

  for (const [index, entry] of entries.entries()) {
    assert.equal(mapped[index]?.expiresAt.getTime(), entry.publishedAt.getTime() + retentionMs);
  }
});
