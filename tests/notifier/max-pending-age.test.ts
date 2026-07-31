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

test("una noticia más antigua que el período máximo configurado no se envía, aunque nunca haya sido entregada (FR-002)", async () => {
  const maxPendingAgeMs = 3 * 24 * 60 * 60 * 1000; // 3 días
  const config = defaultNotifierConfig({ maxPendingAgeMs });
  const now = new Date("2026-07-29T00:00:00.000Z");

  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    // Justo dentro del límite (2 días y medio de antigüedad).
    makeNewsDoc({ link: "https://tandil.example/vigente", title: "Vigente", summary: "...", publishedAt: new Date("2026-07-26T12:00:00.000Z") }),
    // Más vieja que maxPendingAgeMs (5 días de antigüedad): descartada, nunca entregada.
    makeNewsDoc({ link: "https://tandil.example/vencida", title: "Vencida", summary: "...", publishedAt: new Date("2026-07-24T00:00:00.000Z") }),
  ]);

  const sender = makeFakeEmailSender();
  const summary = await runDigestOnce({ db: mongo.db, emailSender: sender, now, config });

  assert.equal(sender.sentMessages.length, 1);
  const message = sender.sentMessages[0]!;
  assert.ok(message.text.includes("Vigente"));
  assert.ok(!message.text.includes("Vencida"), "una noticia vencida no debe enviarse, ni siquiera tarde");
  assert.equal(summary.itemsDelivered, 1);
});
