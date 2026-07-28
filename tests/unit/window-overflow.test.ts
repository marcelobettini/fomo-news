import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAtomFeed } from "../../src/adapters/source.js";
import { evaluateAlarms } from "../../src/core/alarms.js";
import { readFixture } from "./testHelpers.js";

test("window-overflow.xml dispara la misma alarma de rotación completa que full-rotation.xml (FR-013/FR-022)", () => {
  const feed = parseAtomFeed(readFixture("window-overflow.xml"));
  const entriesSeen = feed.totalEntriesInFeed;
  const entriesNew = feed.entries.length;

  const alarms = evaluateAlarms({
    entriesSeen,
    entriesNew,
    hasPriorSuccessfulRun: true,
    now: new Date("2026-07-27T12:00:00Z"),
    lastTargetCategoryObservedAt: new Date("2026-07-27T09:00:00Z"),
    categorySilenceThresholdMs: 24 * 60 * 60 * 1000,
  });

  assert.ok(
    alarms.includes("full-window-rotation"),
    "no existe un código de alarma separado para 'más entradas que la ventana': es el mismo mecanismo (ver spec.md FR-022)",
  );
});
