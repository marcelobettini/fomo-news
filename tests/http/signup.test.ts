import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import type { SubscriberDocument } from "../../src/adapters/subscriberRepository.js";
import {
  startTestMongo,
  clearSubscribers,
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
    signupRateLimitMaxPerIp: 10_000,
    signupRateLimitWindowMs: 60_000,
    emailWebhookSigningSecret: "test-webhook-signing-secret",
    emailSuppressionHashSecret: "test-suppression-hash-secret",
    unsubscribeTokenSecret: "test-unsubscribe-token-secret",
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

test("POST /subscribers con una dirección nueva crea pending y envía exactamente un mensaje de confirmación con enlace de baja (FR-001/FR-002/FR-003/FR-008)", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/subscribers",
    payload: { email: "nueva@example.com" },
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { status: "ok" });

  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "nueva@example.com" });
  assert.ok(doc, "debe existir un documento pendiente");
  assert.equal(doc?.status, "pending");
  assert.ok(doc?.confirmationTokenExpiresAt, "debe tener vencimiento de confirmación");
  assert.ok(doc?.activatedAt === undefined, "no debe estar activado todavía");

  assert.equal(emailSender.sentMessages.length, 1);
  const message = emailSender.sentMessages[0];
  assert.equal(message?.to, "nueva@example.com");
  assert.ok(message?.text.includes(`${PUBLIC_BASE_URL}/subscribers/confirm/`), "debe incluir URL de confirmación");
  assert.ok(message?.text.includes(`${PUBLIC_BASE_URL}/subscribers/unsubscribe/`), "debe incluir URL de baja");
  assert.ok(message?.headers["List-Unsubscribe"]?.includes(`${PUBLIC_BASE_URL}/subscribers/unsubscribe/`));
  assert.equal(message?.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("normaliza la dirección (trim + minúsculas) al construir el _id del documento", async () => {
  await app.inject({
    method: "POST",
    url: "/subscribers",
    payload: { email: "  MixedCase@Example.com  " },
  });

  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "mixedcase@example.com" });
  assert.ok(doc, "debe normalizar la dirección antes de persistir");
});
