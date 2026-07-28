import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import { localDayRangeUtc } from "../../src/core/localTime.js";
import { startTestMongo, seedNews, clearNews, makeNewsDoc, type TestMongo } from "./testHelpers.js";

const TIMEZONE = "America/Argentina/Buenos_Aires";

let mongo: TestMongo;
let app: FastifyInstance;

before(async () => {
  mongo = await startTestMongo();
  app = await buildApp({
    db: mongo.db,
    timeZone: TIMEZONE,
    rateLimitMaxPerIp: 10_000,
    rateLimitWindowMs: 60_000,
    // TTL 0: cada test de esta suite verifica la consulta en sí, no el comportamiento de
    // caché (eso lo cubre cache-validators.test.ts) — sin esto, la caché devolvería datos
    // del test anterior tras el `clearNews` de `beforeEach`.
    cacheTtlMs: 0,
  });
});

after(async () => {
  await app.close();
  await mongo.stop();
});

beforeEach(async () => {
  await clearNews(mongo.db);
});

test("GET /news con noticias del día devuelve 200, orden descendente y solo los 4 campos del contrato (FR-001, FR-002, FR-003)", async () => {
  const now = new Date();
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://example.com/a", title: "Más vieja", publishedAt: new Date(now.getTime() - 60_000) }),
    makeNewsDoc({ link: "https://example.com/b", title: "Más nueva", publishedAt: now }),
  ]);

  const response = await app.inject({ method: "GET", url: "/news" });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { date: string; timezone: string; count: number; news: unknown[] };
  assert.equal(body.timezone, TIMEZONE);
  assert.equal(body.count, 2);
  assert.equal(body.news.length, 2);
  assert.deepEqual(Object.keys(body.news[0] as object).sort(), ["link", "publishedAt", "summary", "title"]);
  assert.equal((body.news[0] as { title: string }).title, "Más nueva");
  assert.equal((body.news[1] as { title: string }).title, "Más vieja");
});

test("GET /news sin noticias hoy devuelve 200 con news: [] (nunca error) (FR-006)", async () => {
  const response = await app.inject({ method: "GET", url: "/news" });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { count: number; news: unknown[] };
  assert.equal(body.count, 0);
  assert.deepEqual(body.news, []);
});

test("una noticia del día local anterior queda excluida del día en curso, aunque su UTC caiga hoy (FR-011, FR-012)", async () => {
  const { startUtc } = localDayRangeUtc(new Date(), TIMEZONE);
  const beforeMidnight = new Date(startUtc.getTime() - 1);
  const afterMidnight = new Date(startUtc.getTime() + 1_000);

  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://example.com/yesterday", title: "Del día anterior", publishedAt: beforeMidnight }),
    makeNewsDoc({ link: "https://example.com/today", title: "De hoy", publishedAt: afterMidnight }),
  ]);

  const response = await app.inject({ method: "GET", url: "/news" });

  assert.equal(response.statusCode, 200);
  const body = response.json() as { news: Array<{ title: string }> };
  assert.equal(body.news.length, 1);
  assert.equal(body.news[0]?.title, "De hoy");
});
