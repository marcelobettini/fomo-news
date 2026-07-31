import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import { hashToken } from "../../src/core/tokens.js";
import type { SubscriberDocument, SuppressionDocument } from "../../src/adapters/subscriberRepository.js";
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

function extractConfirmationToken(text: string): string {
  const match = text.match(/\/subscribers\/confirm\/([^\s\n]+)/);
  assert.ok(match, "el mensaje debe incluir una URL de confirmación");
  return match![1]!;
}

function extractUnsubscribeToken(text: string): string {
  const match = text.match(/\/subscribers\/unsubscribe\/([^\s\n]+)/);
  assert.ok(match, "el mensaje debe incluir una URL de baja");
  return match![1]!;
}

test("GET /subscribers/unsubscribe/:token elimina el documento y crea supresión no reconocible; es idempotente (FR-009/FR-010)", async () => {
  const rawToken = "unsub-raw-token-get";
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({
      _id: "baja-get@example.com",
      status: "active",
      unsubscribeTokenHash: hashToken(rawToken),
    }),
  ]);

  const first = await app.inject({ method: "GET", url: `/subscribers/unsubscribe/${rawToken}` });
  assert.equal(first.statusCode, 200);

  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "baja-get@example.com" });
  assert.equal(doc, null, "el documento debe eliminarse");

  const suppressions = await mongo.db.collection<SuppressionDocument>("suppressions").find({}).toArray();
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.reason, "unsubscribed");
  assert.notEqual(suppressions[0]?._id, "baja-get@example.com", "el _id de supresión no debe ser la dirección de correo");

  const second = await app.inject({ method: "GET", url: `/subscribers/unsubscribe/${rawToken}` });
  assert.equal(second.statusCode, 200, "una segunda invocación sigue siendo 200 (idempotente)");

  const suppressionsAfterRepeat = await mongo.db.collection<SuppressionDocument>("suppressions").find({}).toArray();
  assert.equal(suppressionsAfterRepeat.length, 1, "no debe duplicar la supresión");
});

test("POST /subscribers/unsubscribe/:token (baja de un clic RFC 8058) produce el mismo resultado que GET, sobre un token fresco", async () => {
  await app.inject({
    method: "POST",
    url: "/subscribers",
    payload: { email: "un-clic@example.com" },
  });
  const confirmationToken = extractConfirmationToken(emailSender.sentMessages[0]!.text);
  const unsubscribeToken = extractUnsubscribeToken(emailSender.sentMessages[0]!.text);
  await app.inject({ method: "GET", url: `/subscribers/confirm/${confirmationToken}` });

  const response = await app.inject({
    method: "POST",
    url: `/subscribers/unsubscribe/${unsubscribeToken}`,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "List-Unsubscribe=One-Click",
  });

  assert.equal(response.statusCode, 200);
  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "un-clic@example.com" });
  assert.equal(doc, null);
});

test("tras la baja, una nueva alta para la misma dirección crea un pending nuevo que requiere confirmación (FR-011/FR-012)", async () => {
  const rawToken = "unsub-raw-token-resignup";
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({
      _id: "resuscripcion@example.com",
      status: "active",
      unsubscribeTokenHash: hashToken(rawToken),
    }),
  ]);
  await app.inject({ method: "GET", url: `/subscribers/unsubscribe/${rawToken}` });

  emailSender.sentMessages.length = 0;
  const signupResponse = await app.inject({
    method: "POST",
    url: "/subscribers",
    payload: { email: "resuscripcion@example.com" },
  });
  assert.equal(signupResponse.statusCode, 202);

  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "resuscripcion@example.com" });
  assert.equal(doc?.status, "pending");
  assert.equal(emailSender.sentMessages.length, 1, "debe enviar un nuevo mensaje de confirmación");
});
