import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runDigestOnce } from "../../src/notifier.js";
import type { NewsDocument } from "../../src/adapters/repository.js";
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

test("una noticia actualizada tras ser entregada no genera un nuevo envío (FR-016)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Título original", summary: "Resumen original", publishedAt: new Date("2026-07-20T00:00:00.000Z") }),
  ]);

  const now1 = new Date("2026-07-29T00:00:00.000Z");
  const senderRun1 = makeFakeEmailSender();
  await runDigestOnce({ db: mongo.db, emailSender: senderRun1, now: now1, config: defaultNotifierConfig() });
  assert.equal(senderRun1.sentMessages.length, 1);

  // El ingestor (feature 1) actualiza la noticia ya entregada — misma identidad (`_id`/link),
  // contenido distinto.
  await mongo.db.collection<NewsDocument>("news").updateOne(
    { _id: "https://tandil.example/1" },
    { $set: { title: "Título actualizado", summary: "Resumen actualizado", updatedAt: new Date("2026-07-29T01:00:00.000Z") } },
  );

  const now2 = new Date("2026-07-29T06:00:00.000Z");
  const senderRun2 = makeFakeEmailSender();
  const summary2 = await runDigestOnce({ db: mongo.db, emailSender: senderRun2, now: now2, config: defaultNotifierConfig() });

  assert.equal(senderRun2.sentMessages.length, 0, "la identidad (newsId) ya fue entregada; el contenido no importa");
  assert.equal(summary2.itemsDelivered, 0);
});
