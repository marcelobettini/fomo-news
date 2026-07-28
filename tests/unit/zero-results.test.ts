import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { determineRunStatus } from "../../src/core/alarms.js";
import { readFixture } from "./testHelpers.js";

test("una corrida con entriesSeen === 0 nunca se marca exitosa (FR-017)", () => {
  const feed = parseAtomFeed(readFixture("empty.xml"));

  assert.equal(feed.totalEntriesInFeed, 0);
  assert.equal(determineRunStatus(feed.totalEntriesInFeed, false), "failure");
});

test("una corrida con entradas vistas pero cero nuevas sí es exitosa (SC-003)", () => {
  assert.equal(determineRunStatus(5, false), "success");
});

test("un error de descarga/parseo siempre produce una corrida fallida", () => {
  assert.equal(determineRunStatus(20, true), "failure");
});
