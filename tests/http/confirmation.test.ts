import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import { hashToken } from "../../src/core/tokens.js";
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
    signupRateLimitMaxPerIp: 10_000,
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

function extractConfirmationToken(text: string): string {
  const match = text.match(/\/subscribers\/confirm\/([^\s\n]+)/);
  assert.ok(match, "el mensaje debe incluir una URL de confirmación");
  return match![1]!;
}

test("ciclo completo: token válido activa; reutilizarlo da 409; vencido da 410; inexistente da 404 (FR-004/FR-005/FR-006)", async () => {
  await app.inject({
    method: "POST",
    url: "/subscribers",
    payload: { email: "ciclo@example.com" },
  });
  const token = extractConfirmationToken(emailSender.sentMessages[0]!.text);

  const first = await app.inject({ method: "GET", url: `/subscribers/confirm/${token}` });
  assert.equal(first.statusCode, 200);
  const firstBody = first.json() as { status: string; activatedAt: string };
  assert.equal(firstBody.status, "active");
  assert.ok(firstBody.activatedAt);

  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "ciclo@example.com" });
  assert.equal(doc?.status, "active");
  assert.ok(doc?.activatedAt);
  assert.equal(doc?.confirmationTokenExpiresAt, undefined);

  const reused = await app.inject({ method: "GET", url: `/subscribers/confirm/${token}` });
  assert.equal(reused.statusCode, 409);

  const unchanged = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "ciclo@example.com" });
  assert.equal(unchanged?.status, "active");

  const expiredRawToken = "expired-raw-token";
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({
      _id: "vencido@example.com",
      confirmationTokenHash: hashToken(expiredRawToken),
      confirmationTokenExpiresAt: new Date(Date.now() - 1000),
    }),
  ]);
  const expired = await app.inject({ method: "GET", url: `/subscribers/confirm/${expiredRawToken}` });
  assert.equal(expired.statusCode, 410);

  const missing = await app.inject({ method: "GET", url: "/subscribers/confirm/no-existe-este-token" });
  assert.equal(missing.statusCode, 404);
});
