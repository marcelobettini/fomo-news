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
} from "./testHelpers.js";

let mongo: TestMongo;

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
});

test("dos envíos sucesivos, sin cambios entre medio, el segundo no genera mensajes nuevos (FR-004, criterio de aceptación 1)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-20T00:00:00.000Z") }),
  ]);

  const now1 = new Date("2026-07-29T10:00:00.000Z");
  const senderRun1 = makeFakeEmailSender();
  const summary1 = await runDigestOnce({ db: mongo.db, emailSender: senderRun1, now: now1, config: defaultNotifierConfig() });
  assert.equal(senderRun1.sentMessages.length, 1);
  assert.equal(summary1.itemsDelivered, 1);

  const now2 = new Date("2026-07-29T16:00:00.000Z");
  const senderRun2 = makeFakeEmailSender();
  const summary2 = await runDigestOnce({ db: mongo.db, emailSender: senderRun2, now: now2, config: defaultNotifierConfig() });
  assert.equal(senderRun2.sentMessages.length, 0, "la segunda corrida no debe reenviar lo ya entregado");
  assert.equal(summary2.itemsDelivered, 0);
});
