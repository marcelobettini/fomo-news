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

test("si el canal falla para un suscriptor y funciona para otro, solo el primero vuelve a recibir el contenido en el envío siguiente (FR-012/FR-014)", async () => {
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({
      _id: "falla@example.com",
      status: "active",
      activatedAt: new Date("2026-07-01T00:00:00.000Z"),
      confirmationTokenHash: "hash-falla",
      unsubscribeTokenHash: "unsub-hash-falla",
    }),
    makeSubscriberDoc({
      _id: "funciona@example.com",
      status: "active",
      activatedAt: new Date("2026-07-01T00:00:00.000Z"),
      confirmationTokenHash: "hash-funciona",
      unsubscribeTokenHash: "unsub-hash-funciona",
    }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-20T00:00:00.000Z") }),
  ]);

  const now1 = new Date("2026-07-29T00:00:00.000Z");
  const senderRun1 = makeFakeEmailSender();
  senderRun1.resultFor = (message) => (message.to === "falla@example.com" ? "failed" : "confirmed");

  const summary1 = await runDigestOnce({ db: mongo.db, emailSender: senderRun1, now: now1, config: defaultNotifierConfig() });
  assert.equal(summary1.sendFailures, 1);
  assert.equal(summary1.itemsDelivered, 1, "solo se registra la entrega confirmada");

  const deliveredFalla = await mongo.db.collection("deliveries").countDocuments({ subscriberId: "falla@example.com" });
  const deliveredFunciona = await mongo.db.collection("deliveries").countDocuments({ subscriberId: "funciona@example.com" });
  assert.equal(deliveredFalla, 0);
  assert.equal(deliveredFunciona, 1);

  // Corrida siguiente: el canal ya funciona para todos.
  const now2 = new Date("2026-07-29T06:00:00.000Z");
  const senderRun2 = makeFakeEmailSender();
  await runDigestOnce({ db: mongo.db, emailSender: senderRun2, now: now2, config: defaultNotifierConfig() });

  const destinatarios = senderRun2.sentMessages.map((m) => m.to);
  assert.deepEqual(destinatarios, ["falla@example.com"], "solo quien no lo había recibido vuelve a recibirlo");
});
