import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { mapEntryToNews } from "../../src/core/mapEntry.js";
import { readFixture } from "./testHelpers.js";

const TEST_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

test("descarta toda entrada que no sea de la categoría objetivo (FR-005)", () => {
  const feed = parseAtomFeed(readFixture("mixed-categories.xml"));
  const targetCategory = "Policiales";

  const kept = feed.entries.map((entry) => mapEntryToNews(entry, TEST_RETENTION_MS)).filter((entry) => entry.category === targetCategory);

  assert.equal(feed.entries.length, 3);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.link, "https://diariotandil.example/policiales/corte-transito-obras-centro");
});
