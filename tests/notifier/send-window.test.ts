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

test("fuera de la ventana horaria permitida no se envía nada; dentro de la ventana se entrega lo acumulado (FR-005)", async () => {
  const config = defaultNotifierConfig({ sendWindowStartLocal: "08:00", sendWindowEndLocal: "20:00" });
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-28T00:00:00.000Z") }),
  ]);

  // 2026-07-29T04:00:00Z en America/Argentina/Buenos_Aires (UTC-3) es 01:00 local: fuera de [08:00, 20:00].
  const outsideWindow = new Date("2026-07-29T04:00:00.000Z");
  const senderOutside = makeFakeEmailSender();
  const summaryOutside = await runDigestOnce({ db: mongo.db, emailSender: senderOutside, now: outsideWindow, config });
  assert.equal(senderOutside.sentMessages.length, 0);
  assert.equal(summaryOutside.subscribersProcessed, 0, "fuera de ventana no debe ni leer suscriptores");

  const insideCount = await mongo.db.collection("deliveries").countDocuments({});
  assert.equal(insideCount, 0);

  // 2026-07-29T15:00:00Z (UTC-3) es 12:00 local: dentro de [08:00, 20:00].
  const insideWindow = new Date("2026-07-29T15:00:00.000Z");
  const senderInside = makeFakeEmailSender();
  const summaryInside = await runDigestOnce({ db: mongo.db, emailSender: senderInside, now: insideWindow, config });
  assert.equal(senderInside.sentMessages.length, 1, "lo acumulado se entrega en el primer envío dentro de la ventana");
  assert.equal(summaryInside.itemsDelivered, 1);
});

test("dos corridas distintas dentro de la misma ventana horaria se resuelven con el mismo procedimiento, sin rama especial de 'primer envío del día' (FR-006)", async () => {
  const config = defaultNotifierConfig({ sendWindowStartLocal: "08:00", sendWindowEndLocal: "20:00" });
  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt: new Date("2026-07-01T00:00:00.000Z") }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "...", publishedAt: new Date("2026-07-28T00:00:00.000Z") }),
  ]);

  // Primer envío del día, 12:00 local.
  const firstRun = new Date("2026-07-29T15:00:00.000Z");
  const senderFirst = makeFakeEmailSender();
  await runDigestOnce({ db: mongo.db, emailSender: senderFirst, now: firstRun, config });
  assert.equal(senderFirst.sentMessages.length, 1);
  assert.ok(senderFirst.sentMessages[0]!.text.includes("Uno"));

  // Llega una noticia nueva entre los dos envíos.
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/2", title: "Dos", summary: "...", publishedAt: new Date("2026-07-29T16:00:00.000Z") }),
  ]);

  // Segundo envío del mismo día, 18:00 local: mismo procedimiento, solo entrega lo nuevo.
  const secondRun = new Date("2026-07-29T21:00:00.000Z");
  const senderSecond = makeFakeEmailSender();
  await runDigestOnce({ db: mongo.db, emailSender: senderSecond, now: secondRun, config });
  assert.equal(senderSecond.sentMessages.length, 1);
  assert.ok(senderSecond.sentMessages[0]!.text.includes("Dos"));
  assert.ok(!senderSecond.sentMessages[0]!.text.includes("Uno"), "lo del primer envío no se repite");
});
