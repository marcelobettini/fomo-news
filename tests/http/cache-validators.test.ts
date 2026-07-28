import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import { startTestMongo, seedNews, clearNews, makeNewsDoc, type TestMongo } from "./testHelpers.js";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const TTL_MS = 50;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let mongo: TestMongo;
let app: FastifyInstance;

before(async () => {
  mongo = await startTestMongo();
  app = await buildApp({
    db: mongo.db,
    timeZone: TIMEZONE,
    rateLimitMaxPerIp: 10_000,
    rateLimitWindowMs: 60_000,
    cacheTtlMs: TTL_MS,
  });
});

after(async () => {
  await app.close();
  await mongo.stop();
});

beforeEach(async () => {
  await clearNews(mongo.db);
});

test("dos peticiones consecutivas dentro del TTL devuelven el mismo ETag y el mismo cuerpo (FR-008)", async () => {
  await seedNews(mongo.db, [makeNewsDoc({ link: "https://example.com/a", publishedAt: new Date() })]);

  const first = await app.inject({ method: "GET", url: "/news" });
  const second = await app.inject({ method: "GET", url: "/news" });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.ok(first.headers.etag, "la respuesta debe incluir ETag");
  assert.equal(first.headers.etag, second.headers.etag);
  assert.deepEqual(first.json(), second.json());
});

test("If-None-Match con el ETag vigente devuelve 304 sin cuerpo (FR-009)", async () => {
  await seedNews(mongo.db, [makeNewsDoc({ link: "https://example.com/b", publishedAt: new Date() })]);

  const first = await app.inject({ method: "GET", url: "/news" });
  const etag = first.headers.etag as string;

  const conditional = await app.inject({
    method: "GET",
    url: "/news",
    headers: { "if-none-match": etag },
  });

  assert.equal(conditional.statusCode, 304);
  assert.equal(conditional.body, "");
});

test("tras vencer el TTL y cambiar el contenido real, el ETag cambia y el If-None-Match anterior ya no aplica (FR-008/FR-009)", async () => {
  await seedNews(mongo.db, [makeNewsDoc({ link: "https://example.com/c", publishedAt: new Date() })]);

  const first = await app.inject({ method: "GET", url: "/news" });
  const oldEtag = first.headers.etag as string;

  await wait(TTL_MS + 20);
  await seedNews(mongo.db, [makeNewsDoc({ link: "https://example.com/d", publishedAt: new Date() })]);

  const updated = await app.inject({
    method: "GET",
    url: "/news",
    headers: { "if-none-match": oldEtag },
  });

  assert.equal(updated.statusCode, 200);
  assert.notEqual(updated.headers.etag, oldEtag);
  const body = updated.json() as { count: number };
  assert.equal(body.count, 2);
});
