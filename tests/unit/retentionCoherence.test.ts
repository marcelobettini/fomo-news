import { test } from "node:test";
import assert from "node:assert/strict";
import { assertRetentionCoherent } from "../../src/core/retentionCoherence.js";

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

test("lanza cuando newsRetentionMs es menor o igual que maxSendIntervalMs + maxPendingAgeMs (FR-020)", () => {
  assert.throws(() =>
    assertRetentionCoherent({
      newsRetentionMs: 7 * ONE_DAY_MS,
      maxSendIntervalMs: ONE_HOUR_MS,
      maxPendingAgeMs: 7 * ONE_DAY_MS,
    }),
  );
});

test("lanza en el caso límite exacto de igualdad (no es 'estrictamente mayor')", () => {
  assert.throws(() =>
    assertRetentionCoherent({
      newsRetentionMs: 8 * ONE_DAY_MS,
      maxSendIntervalMs: ONE_DAY_MS,
      maxPendingAgeMs: 7 * ONE_DAY_MS,
    }),
  );
});

test("no lanza cuando la desigualdad estricta se cumple", () => {
  assert.doesNotThrow(() =>
    assertRetentionCoherent({
      newsRetentionMs: 30 * ONE_DAY_MS,
      maxSendIntervalMs: 6 * ONE_HOUR_MS,
      maxPendingAgeMs: 7 * ONE_DAY_MS,
    }),
  );
});
