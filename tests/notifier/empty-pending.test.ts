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

test("un suscriptor activo sin ninguna noticia elegible no recibe ningún mensaje (FR-007)", async () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "sinpendientes@example.com", status: "active", activatedAt: new Date("2026-07-28T00:00:00.000Z") }),
  ]);
  // Única noticia disponible, publicada antes de la activación: no es elegible.
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/vieja", title: "Vieja", summary: "...", publishedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);

  const summary = await runDigestOnce({ db: mongo.db, emailSender, now, config: defaultNotifierConfig() });

  assert.equal(emailSender.sentMessages.length, 0);
  assert.equal(summary.messagesSent, 0);
  assert.equal(summary.subscribersProcessed, 1);
});

test("sin ninguna noticia en el sistema, ningún suscriptor activo recibe nada", async () => {
  const now = new Date("2026-07-29T00:00:00.000Z");
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);

  const summary = await runDigestOnce({ db: mongo.db, emailSender, now, config: defaultNotifierConfig() });

  assert.equal(emailSender.sentMessages.length, 0);
  assert.equal(summary.messagesSent, 0);
});
