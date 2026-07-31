import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/http/app.js";
import type { SubscriberDocument, SuppressionDocument } from "../../src/adapters/subscriberRepository.js";
import {
  startTestMongo,
  clearSubscribers,
  seedSubscribers,
  makeSubscriberDoc,
  makeFakeEmailSender,
  type TestMongo,
} from "./testHelpers.js";

const TIMEZONE = "America/Argentina/Buenos_Aires";
const PUBLIC_BASE_URL = "https://noticias.tandil.example";
const WEBHOOK_SECRET = "test-webhook-signing-secret";

let mongo: TestMongo;
let app: FastifyInstance;

before(async () => {
  mongo = await startTestMongo();
  app = await buildApp({
    db: mongo.db,
    timeZone: TIMEZONE,
    rateLimitMaxPerIp: 10_000,
    rateLimitWindowMs: 60_000,
    cacheTtlMs: 60_000,
    subscribersDb: mongo.db,
    emailSender: makeFakeEmailSender(),
    publicBaseUrl: PUBLIC_BASE_URL,
    confirmationTokenTtlMs: 24 * 60 * 60 * 1000,
    signupResendCooldownMs: 60_000,
    signupRateLimitMaxPerIp: 10_000,
    signupRateLimitWindowMs: 60_000,
    emailWebhookSigningSecret: WEBHOOK_SECRET,
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
});

function sendSignedWebhook(rawBody: string, options: { badSignature?: boolean } = {}) {
  const svixId = "msg_test";
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  let signature = createHmac("sha256", WEBHOOK_SECRET).update(signedContent).digest("base64");
  if (options.badSignature) {
    signature = signature.slice(0, -1) + (signature.at(-1) === "A" ? "B" : "A");
  }
  return app.inject({
    method: "POST",
    url: "/webhooks/email",
    headers: {
      "content-type": "application/json",
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": `v1,${signature}`,
    },
    payload: rawBody,
  });
}

test("firma válida + fallo permanente elimina al suscriptor activo con supresión hard_bounce (FR-012)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "rebote@example.com", status: "active" }),
  ]);
  const body = JSON.stringify({
    type: "email.bounced",
    data: { bounce_type: "Permanent", to: ["rebote@example.com"] },
  });

  const response = await sendSignedWebhook(body);

  assert.equal(response.statusCode, 200);
  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "rebote@example.com" });
  assert.equal(doc, null);
  const suppressions = await mongo.db.collection<SuppressionDocument>("suppressions").find({}).toArray();
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.reason, "hard_bounce");
});

test("firma válida + queja elimina al suscriptor activo con supresión complaint (FR-013)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "queja@example.com", status: "active" }),
  ]);
  const body = JSON.stringify({
    type: "email.complained",
    data: { to: ["queja@example.com"] },
  });

  const response = await sendSignedWebhook(body);

  assert.equal(response.statusCode, 200);
  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "queja@example.com" });
  assert.equal(doc, null);
  const suppressions = await mongo.db.collection<SuppressionDocument>("suppressions").find({}).toArray();
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.reason, "complaint");
});

test("fallo transitorio deja al suscriptor activo, sin crear ninguna supresión (FR-014)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "transitorio@example.com", status: "active" }),
  ]);
  const body = JSON.stringify({
    type: "email.bounced",
    data: { bounce_type: "Transient", to: ["transitorio@example.com"] },
  });

  const response = await sendSignedWebhook(body);

  assert.equal(response.statusCode, 200);
  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "transitorio@example.com" });
  assert.equal(doc?.status, "active");
  const suppressions = await mongo.db.collection<SuppressionDocument>("suppressions").find({}).toArray();
  assert.equal(suppressions.length, 0);
});

test("firma inválida responde 401 y no modifica ningún documento (research.md §3)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "protegido@example.com", status: "active" }),
  ]);
  const body = JSON.stringify({
    type: "email.bounced",
    data: { bounce_type: "Permanent", to: ["protegido@example.com"] },
  });

  const response = await sendSignedWebhook(body, { badSignature: true });

  assert.equal(response.statusCode, 401);
  const doc = await mongo.db.collection<SubscriberDocument>("subscribers").findOne({ _id: "protegido@example.com" });
  assert.equal(doc?.status, "active", "ningún documento debe cambiar ante una firma inválida");
  const suppressions = await mongo.db.collection<SuppressionDocument>("suppressions").find({}).toArray();
  assert.equal(suppressions.length, 0);
});
