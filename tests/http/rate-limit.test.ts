import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import {
  startTestMongo,
  seedNews,
  makeNewsDoc,
  defaultSubscriberAppConfig,
  type TestMongo,
} from "./testHelpers.js";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const MAX_PER_IP = 3;

let mongo: TestMongo;
let app: FastifyInstance;

before(async () => {
  mongo = await startTestMongo();
  await seedNews(mongo.db, [makeNewsDoc({ link: "https://example.com/rl", publishedAt: new Date() })]);
  app = await buildApp({
    db: mongo.db,
    timeZone: TIMEZONE,
    rateLimitMaxPerIp: MAX_PER_IP,
    rateLimitWindowMs: 60_000,
    cacheTtlMs: 60_000,
    ...defaultSubscriberAppConfig(mongo.db),
  });
});

after(async () => {
  await app.close();
  await mongo.stop();
});

test("un origen que excede el umbral recibe 429, distinguible de 503; otro origen sigue funcionando (FR-010)", async () => {
  const ipA = "203.0.113.10";
  const ipB = "203.0.113.20";

  for (let i = 0; i < MAX_PER_IP; i++) {
    const response = await app.inject({ method: "GET", url: "/news", remoteAddress: ipA });
    assert.equal(response.statusCode, 200, `petición ${i + 1} de IP A dentro del umbral debería ser 200`);
  }

  const exceeded = await app.inject({ method: "GET", url: "/news", remoteAddress: ipA });
  assert.equal(exceeded.statusCode, 429);
  assert.notEqual(exceeded.statusCode, 503, "el rechazo por exceso nunca debe confundirse con un fallo del servicio");

  const otherOrigin = await app.inject({ method: "GET", url: "/news", remoteAddress: ipB });
  assert.equal(otherOrigin.statusCode, 200, "otra IP no debe verse afectada por el límite de la primera");
});
