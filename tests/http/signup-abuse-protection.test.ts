import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import type { SubscriberDocument } from "../../src/adapters/subscriberRepository.js";
import {
  startTestMongo,
  clearSubscribers,
  seedSubscribers,
  makeSubscriberDoc,
  makeFakeEmailSender,
  type TestMongo,
  type FakeEmailSender,
} from "./testHelpers.js";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const PUBLIC_BASE_URL = "https://noticias.tandil.example";

let mongo: TestMongo;
let app: FastifyInstance;
let emailSender: FakeEmailSender;

before(async () => {
  mongo = await startTestMongo();
  emailSender = makeFakeEmailSender();
  app = await buildApp({
    db: mongo.db,
    timeZone: TIMEZONE,
    rateLimitMaxPerIp: 10_000,
    rateLimitWindowMs: 60_000,
    cacheTtlMs: 60_000,
    subscribersDb: mongo.db,
    emailSender,
    publicBaseUrl: PUBLIC_BASE_URL,
    confirmationTokenTtlMs: 24 * 60 * 60 * 1000,
    signupResendCooldownMs: 60_000,
    signupRateLimitMaxPerIp: 3,
    signupRateLimitWindowMs: 60_000,
    emailWebhookSigningSecret: "test-webhook-signing-secret",
    emailSuppressionHashSecret: "test-suppression-hash-secret",
  });
});

after(async () => {
  await app.close();
  await mongo.stop();
});

beforeEach(async () => {
  await clearSubscribers(mongo.db);
  emailSender.sentMessages.length = 0;
});

test("solicitudes repetidas para la misma dirección pendiente, dentro del cooldown, no agregan mensajes nuevos (FR-015)", async () => {
  const ip = "203.0.113.50";
  const email = "repetida@example.com";

  await app.inject({ method: "POST", url: "/subscribers", payload: { email }, remoteAddress: ip });
  await app.inject({ method: "POST", url: "/subscribers", payload: { email }, remoteAddress: ip });
  const third = await app.inject({ method: "POST", url: "/subscribers", payload: { email }, remoteAddress: ip });

  assert.equal(third.statusCode, 202);
  assert.equal(emailSender.sentMessages.length, 1, "solo debe haberse enviado un mensaje, no uno por solicitud");

  const docs = await mongo.db.collection<SubscriberDocument>("subscribers").find({ _id: email }).toArray();
  assert.equal(docs.length, 1, "no debe acumular más de un documento pendiente");
});

test("un origen que excede SIGNUP_RATE_LIMIT_MAX_PER_IP responde 429, sin afectar el límite de GET /news (FR-016)", async () => {
  const ip = "203.0.113.60";

  for (let i = 0; i < 3; i++) {
    const response = await app.inject({
      method: "POST",
      url: "/subscribers",
      payload: { email: `origen-${i}@example.com` },
      remoteAddress: ip,
    });
    assert.equal(response.statusCode, 202, `solicitud ${i + 1} dentro del umbral debería ser 202`);
  }

  const exceeded = await app.inject({
    method: "POST",
    url: "/subscribers",
    payload: { email: "origen-exceso@example.com" },
    remoteAddress: ip,
  });
  assert.equal(exceeded.statusCode, 429);

  const newsFromSameIp = await app.inject({ method: "GET", url: "/news", remoteAddress: ip });
  assert.equal(newsFromSameIp.statusCode, 200, "el límite específico de alta no debe afectar a GET /news");
});

test("las respuestas para dirección nueva, pendiente y activa son idénticas en código y cuerpo (FR-017)", async () => {
  const ip = "203.0.113.70";
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "ya-pendiente@example.com", status: "pending" }),
    makeSubscriberDoc({ _id: "ya-activa@example.com", status: "active" }),
  ]);

  const nueva = await app.inject({ method: "POST", url: "/subscribers", payload: { email: "flamante@example.com" }, remoteAddress: ip });
  const pendiente = await app.inject({ method: "POST", url: "/subscribers", payload: { email: "ya-pendiente@example.com" }, remoteAddress: ip });
  const activa = await app.inject({ method: "POST", url: "/subscribers", payload: { email: "ya-activa@example.com" }, remoteAddress: ip });

  assert.equal(nueva.statusCode, 202);
  assert.equal(pendiente.statusCode, 202);
  assert.equal(activa.statusCode, 202);
  assert.deepEqual(nueva.json(), pendiente.json());
  assert.deepEqual(pendiente.json(), activa.json());
});

test("una dirección con formato inválido responde 400 sin capturar ningún mensaje (FR-019)", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/subscribers",
    payload: { email: "no-es-un-correo" },
    remoteAddress: "203.0.113.80",
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "invalid_email" });
  assert.equal(emailSender.sentMessages.length, 0);
});
