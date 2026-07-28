import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { detectNewCategories } from "../../src/core/categories.js";
import { readFixture } from "./testHelpers.js";

test("una categoría nunca antes vista dispara la señal de novedad (FR-015)", () => {
  const feed = parseAtomFeed(readFixture("new-category.xml"));
  const seenThisRun = feed.entries.map((entry) => entry.declaredCategory);
  const knownCategories = new Set(["Policiales", "Deportes", "Espectaculos"]);

  const newCategories = detectNewCategories(seenThisRun, knownCategories);

  assert.deepEqual(newCategories, ["Educacion"]);
});

test("no reporta novedad si la categoría ya era conocida", () => {
  const newCategories = detectNewCategories(["Policiales", "Policiales"], new Set(["Policiales"]));

  assert.deepEqual(newCategories, []);
});
