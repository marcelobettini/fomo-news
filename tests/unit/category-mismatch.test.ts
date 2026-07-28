import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { detectCategoryMismatch, mapEntryToNews } from "../../src/core/mapEntry.js";
import { readFixture } from "./testHelpers.js";

const TEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

test("detecta discrepancia entre categoría declarada y la ruta del enlace (FR-011)", () => {
  const [entry] = parseAtomFeed(readFixture("category-mismatch.xml")).entries;
  assert.ok(entry);

  assert.equal(entry.declaredCategory, "Policiales");
  assert.equal(entry.linkPathCategory, "deportes");
  assert.equal(detectCategoryMismatch(entry), true);
});

test("una discrepancia no impide almacenar la entrada según su categoría declarada", () => {
  const [entry] = parseAtomFeed(readFixture("category-mismatch.xml")).entries;
  assert.ok(entry);

  const mapped = mapEntryToNews(entry, TEST_RETENTION_MS);

  assert.equal(mapped.category, "Policiales");
});

test("no reporta discrepancia cuando ambas categorías coinciden", () => {
  const [entry] = parseAtomFeed(readFixture("normal.xml")).entries;
  assert.ok(entry);

  assert.equal(detectCategoryMismatch(entry), false);
});
