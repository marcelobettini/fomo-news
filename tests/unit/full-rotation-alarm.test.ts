import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { evaluateAlarms } from "../../src/core/alarms.js";
import { readFixture } from "./testHelpers.js";

test("la alarma de rotación completa se dispara cuando 100% es nuevo y hay historial previo", () => {
  const feed = parseAtomFeed(readFixture("full-rotation.xml"));
  const entriesSeen = feed.totalEntriesInFeed;
  const entriesNew = feed.entries.length; // todas nuevas: sin estado previo simulado

  const alarms = evaluateAlarms({
    entriesSeen,
    entriesNew,
    hasPriorSuccessfulRun: true,
    now: new Date("2026-07-27T12:00:00Z"),
    lastTargetCategoryObservedAt: new Date("2026-07-27T11:00:00Z"),
    categorySilenceThresholdMs: 24 * 60 * 60 * 1000,
  });

  assert.ok(alarms.includes("full-window-rotation"));
});

test("no se dispara si no todas las entradas vistas son nuevas", () => {
  const alarms = evaluateAlarms({
    entriesSeen: 5,
    entriesNew: 3,
    hasPriorSuccessfulRun: true,
    now: new Date("2026-07-27T12:00:00Z"),
    lastTargetCategoryObservedAt: new Date("2026-07-27T11:00:00Z"),
    categorySilenceThresholdMs: 24 * 60 * 60 * 1000,
  });

  assert.ok(!alarms.includes("full-window-rotation"));
});
