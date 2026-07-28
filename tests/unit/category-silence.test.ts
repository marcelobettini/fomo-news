import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateAlarms } from "../../src/core/alarms.js";

const THRESHOLD_MS = 24 * 60 * 60 * 1000; // 1 día, valor arbitrario de test
const NOW = new Date("2026-07-27T12:00:00Z");

test("dispara la alarma cuando el umbral de ausencia de categoría objetivo se superó", () => {
  const alarms = evaluateAlarms({
    entriesSeen: 5,
    entriesNew: 2,
    hasPriorSuccessfulRun: true,
    now: NOW,
    lastTargetCategoryObservedAt: new Date(NOW.getTime() - THRESHOLD_MS - 1),
    categorySilenceThresholdMs: THRESHOLD_MS,
  });

  assert.ok(alarms.includes("category-silence"));
});

test("no dispara si la categoría objetivo se vio dentro del umbral", () => {
  const alarms = evaluateAlarms({
    entriesSeen: 5,
    entriesNew: 2,
    hasPriorSuccessfulRun: true,
    now: NOW,
    lastTargetCategoryObservedAt: new Date(NOW.getTime() - THRESHOLD_MS + 1000),
    categorySilenceThresholdMs: THRESHOLD_MS,
  });

  assert.ok(!alarms.includes("category-silence"));
});

test("dispara si la categoría objetivo nunca se vio (lastTargetCategoryObservedAt null)", () => {
  const alarms = evaluateAlarms({
    entriesSeen: 5,
    entriesNew: 2,
    hasPriorSuccessfulRun: true,
    now: NOW,
    lastTargetCategoryObservedAt: null,
    categorySilenceThresholdMs: THRESHOLD_MS,
  });

  assert.ok(alarms.includes("category-silence"));
});
