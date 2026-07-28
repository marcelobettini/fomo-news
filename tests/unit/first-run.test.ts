import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { evaluateAlarms } from "../../src/core/alarms.js";
import { readFixture } from "./testHelpers.js";

test("la alarma de rotación completa se suprime en la primera corrida de la vida del sistema", () => {
  const feed = parseAtomFeed(readFixture("full-rotation.xml"));
  const entriesSeen = feed.totalEntriesInFeed;
  const entriesNew = feed.entries.length;

  const alarms = evaluateAlarms({
    entriesSeen,
    entriesNew,
    hasPriorSuccessfulRun: false, // sin corridas exitosas previas: es la primera
    now: new Date("2026-07-27T12:00:00Z"),
    lastTargetCategoryObservedAt: new Date("2026-07-27T11:00:00Z"),
    categorySilenceThresholdMs: 24 * 60 * 60 * 1000,
  });

  assert.ok(!alarms.includes("full-window-rotation"));
});
