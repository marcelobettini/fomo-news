import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runDigestOnce } from "../../src/notifier.js";
import {
  startNotifierTestMongo,
  makeNewsDoc,
  seedNews,
  makeSubscriberDoc,
  seedSubscribers,
  makeFakeEmailSender,
  defaultNotifierConfig,
  type TestMongo,
  type FakeEmailSender,
} from "./testHelpers.js";

let mongo: TestMongo;
let emailSender: FakeEmailSender;

before(async () => {
  mongo = await startNotifierTestMongo();
});

after(async () => {
  await mongo.stop();
});

beforeEach(async () => {
  await mongo.db.collection("news").deleteMany({});
  await mongo.db.collection("subscribers").deleteMany({});
  await mongo.db.collection("deliveries").deleteMany({});
  emailSender = makeFakeEmailSender();
});

test("un suscriptor pending (sin confirmar) no recibe nada aunque tenga noticias elegibles (FR-017)", async () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "pendiente@example.com", status: "pending" }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-28T00:00:00.000Z") }),
  ]);

  const summary = await runDigestOnce({ db: mongo.db, emailSender, now, config: defaultNotifierConfig() });

  assert.equal(emailSender.sentMessages.length, 0);
  assert.equal(summary.subscribersProcessed, 0, "un suscriptor pending no debe ni contarse como procesado");
});

test("un suscriptor sin documento (dado de baja) no recibe nada, aunque haya noticias elegibles para cualquiera (FR-017)", async () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  // Ningún suscriptor sembrado — simula la baja (el documento ya no existe).
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-28T00:00:00.000Z") }),
  ]);

  const summary = await runDigestOnce({ db: mongo.db, emailSender, now, config: defaultNotifierConfig() });

  assert.equal(emailSender.sentMessages.length, 0);
  assert.equal(summary.subscribersProcessed, 0);
});
