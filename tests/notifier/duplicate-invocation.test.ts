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

test("ejecutar el envío dos veces seguidas con el mismo now no produce mensajes duplicados (FR-013, criterio de aceptación 3)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-20T00:00:00.000Z") }),
  ]);

  const now = new Date("2026-07-29T00:00:00.000Z");
  const config = defaultNotifierConfig();

  const summary1 = await runDigestOnce({ db: mongo.db, emailSender, now, config });
  const summary2 = await runDigestOnce({ db: mongo.db, emailSender, now, config });

  assert.equal(summary1.itemsDelivered, 1);
  assert.equal(summary2.itemsDelivered, 0, "la segunda invocación con el mismo now no debe registrar nada nuevo");
  assert.equal(emailSender.sentMessages.length, 1, "no debe haber un segundo mensaje");

  const deliveredCount = await mongo.db.collection("deliveries").countDocuments({ subscriberId: "persona@example.com" });
  assert.equal(deliveredCount, 1, "no debe haber un segundo registro de entrega para la misma combinación");
});
