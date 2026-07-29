import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../src/http/app.js";
import { startTestMongo, defaultSubscriberAppConfig } from "./testHelpers.js";

const TIMEZONE = "America/Argentina/Buenos_Aires";

test("con el almacenamiento inaccesible, GET /news devuelve 503 explícito, nunca 200 con news: [] (FR-007, requisito crítico)", async () => {
  const mongo = await startTestMongo();
  const app = await buildApp({
    db: mongo.db,
    timeZone: TIMEZONE,
    rateLimitMaxPerIp: 10_000,
    rateLimitWindowMs: 60_000,
    cacheTtlMs: 0,
    ...defaultSubscriberAppConfig(mongo.db),
  });

  // Simula almacenamiento inaccesible: cierra el cliente y detiene el servidor en memoria
  // antes de la petición, de forma que la próxima consulta a Mongo falla.
  await mongo.stop();

  const response = await app.inject({ method: "GET", url: "/news" });

  assert.equal(response.statusCode, 503);
  const body = response.json() as { error: string };
  assert.equal(body.error, "storage_unavailable");

  await app.close();
});
