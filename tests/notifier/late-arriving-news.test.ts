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

test("una noticia incorporada al sistema con fecha de publicación anterior al último envío igualmente se entrega (FR-004, criterio de aceptación 2)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/temprana", title: "Temprana", summary: "...", publishedAt: new Date("2026-07-20T00:00:00.000Z") }),
  ]);

  const now1 = new Date("2026-07-25T00:00:00.000Z");
  const senderRun1 = makeFakeEmailSender();
  await runDigestOnce({ db: mongo.db, emailSender: senderRun1, now: now1, config: defaultNotifierConfig() });
  assert.equal(senderRun1.sentMessages.length, 1);
  assert.ok(senderRun1.sentMessages[0]!.text.includes("Temprana"));

  // Llega tarde al sistema (recuperación tras una caída, o la fuente la reveló tarde): fecha de
  // publicación ANTERIOR a `now1`, la corrida ya ejecutada — se incorpora recién ahora.
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/tardia", title: "Tardía", summary: "...", publishedAt: new Date("2026-07-18T00:00:00.000Z") }),
  ]);

  const now2 = new Date("2026-07-29T00:00:00.000Z");
  const senderRun2 = makeFakeEmailSender();
  const summary2 = await runDigestOnce({ db: mongo.db, emailSender: senderRun2, now: now2, config: defaultNotifierConfig() });

  assert.equal(senderRun2.sentMessages.length, 1);
  assert.ok(senderRun2.sentMessages[0]!.text.includes("Tardía"), "la noticia tardía debe entregarse igual");
  assert.ok(!senderRun2.sentMessages[0]!.text.includes("Temprana"), "la ya entregada no debe repetirse");
  assert.equal(summary2.itemsDelivered, 1);
});
