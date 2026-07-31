import { test } from "node:test";
import assert from "node:assert/strict";
import { loadNotifierEnvConfig } from "../../src/config/notifierEnv.js";
import type { EnvLike } from "../../src/config/env.js";

function validEnv(overrides?: Partial<Record<string, string>>): EnvLike {
  return {
    MONGODB_NOTIFIER_URI: "mongodb://localhost/unused-in-test",
    TIMEZONE: "America/Argentina/Buenos_Aires",
    PUBLIC_BASE_URL: "https://noticias.tandil.example",
    EMAIL_PROVIDER_API_KEY: "unused-in-test",
    EMAIL_SENDER_ADDRESS: "noticias@tandil.example",
    UNSUBSCRIBE_TOKEN_SECRET: "test-secret",
    SEND_WINDOW_START_LOCAL: "08:00",
    SEND_WINDOW_END_LOCAL: "22:00",
    MAX_PENDING_AGE_MS: String(7 * 24 * 60 * 60 * 1000),
    MAX_NEWS_PER_MESSAGE: "20",
    MAX_SEND_INTERVAL_MS: String(6 * 60 * 60 * 1000),
    NEWS_RETENTION_MS: String(30 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

test("con una relación coherente entre retención/envío/pendientes, devuelve la configuración normalmente (FR-020)", () => {
  const config = loadNotifierEnvConfig(validEnv());
  assert.equal(config.mongoNotifierUri, "mongodb://localhost/unused-in-test");
  assert.equal(config.maxPendingAgeMs, 7 * 24 * 60 * 60 * 1000);
});

test("con una relación incoherente (retención no estrictamente mayor que envío + pendientes), lanza un error descriptivo sin efectos secundarios (FR-020)", () => {
  const incoherentEnv = validEnv({
    NEWS_RETENTION_MS: String(7 * 24 * 60 * 60 * 1000),
    MAX_SEND_INTERVAL_MS: String(6 * 60 * 60 * 1000),
    MAX_PENDING_AGE_MS: String(7 * 24 * 60 * 60 * 1000),
  });
  assert.throws(() => loadNotifierEnvConfig(incoherentEnv), /retención incoherente/i);
});
