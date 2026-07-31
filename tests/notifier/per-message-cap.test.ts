import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runDigestOnce } from "../../src/notifier.js";
import { deriveUnsubscribeToken } from "../../src/core/tokens.js";
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

test("con más pendientes que el tope, el mensaje incluye solo las más recientes y señala dónde ver el resto; las excluidas siguen pendientes (FR-009)", async () => {
  const config = defaultNotifierConfig({ maxNewsPerMessage: 2 });
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/vieja", title: "Vieja", summary: "...", publishedAt: new Date("2026-07-20T00:00:00.000Z") }),
    makeNewsDoc({ link: "https://tandil.example/media", title: "Media", summary: "...", publishedAt: new Date("2026-07-22T00:00:00.000Z") }),
    makeNewsDoc({ link: "https://tandil.example/nueva", title: "Nueva", summary: "...", publishedAt: new Date("2026-07-24T00:00:00.000Z") }),
  ]);

  const now1 = new Date("2026-07-29T00:00:00.000Z");
  const senderRun1 = makeFakeEmailSender();
  const summary1 = await runDigestOnce({ db: mongo.db, emailSender: senderRun1, now: now1, config });

  assert.equal(senderRun1.sentMessages.length, 1);
  const message = senderRun1.sentMessages[0]!;
  assert.ok(message.text.includes("Nueva"));
  assert.ok(message.text.includes("Media"));
  assert.ok(!message.text.includes("Vieja"), "excede el tope: solo las más recientes");
  assert.ok(message.text.includes(config.publicBaseUrl + "/news"), "debe indicar dónde consultar el resto");
  assert.equal(summary1.itemsDelivered, 2, "las excluidas por el tope no se registran como entregadas");

  const deliveredCount = await mongo.db.collection("deliveries").countDocuments({ subscriberId: "persona@example.com" });
  assert.equal(deliveredCount, 2);

  // La excluida por el tope sigue pendiente y se entrega en la corrida siguiente.
  const now2 = new Date("2026-07-29T06:00:00.000Z");
  const senderRun2 = makeFakeEmailSender();
  await runDigestOnce({ db: mongo.db, emailSender: senderRun2, now: now2, config });
  assert.equal(senderRun2.sentMessages.length, 1);
  assert.ok(senderRun2.sentMessages[0]!.text.includes("Vieja"));
});

test("cualquier mensaje enviado incluye el enlace de baja y los headers List-Unsubscribe (FR-010)", async () => {
  const config = defaultNotifierConfig();
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-28T00:00:00.000Z") }),
  ]);

  const now = new Date("2026-07-29T00:00:00.000Z");
  const sender = makeFakeEmailSender();
  await runDigestOnce({ db: mongo.db, emailSender: sender, now, config });

  assert.equal(sender.sentMessages.length, 1);
  const message = sender.sentMessages[0]!;

  const expectedToken = deriveUnsubscribeToken("persona@example.com", config.unsubscribeTokenSecret);
  const expectedUrl = `${config.publicBaseUrl}/subscribers/unsubscribe/${expectedToken}`;

  assert.ok(message.text.includes(expectedUrl), "el texto plano debe incluir el enlace de baja determinístico");
  assert.equal(message.headers["List-Unsubscribe"], `<${expectedUrl}>`);
  assert.equal(message.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});
