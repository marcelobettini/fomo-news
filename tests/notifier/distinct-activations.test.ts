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

test("un suscriptor activo recibe exactamente las tres noticias publicadas después de su activación (FR-001/FR-002/FR-003/FR-018)", async () => {
  const activatedAt = new Date("2026-07-20T00:00:00.000Z");
  const now = new Date("2026-07-29T00:00:00.000Z");

  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({ _id: "persona@example.com", status: "active", activatedAt }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/1", title: "Uno", summary: "Resumen uno", publishedAt: new Date("2026-07-21T00:00:00.000Z") }),
    makeNewsDoc({ link: "https://tandil.example/2", title: "Dos", summary: "Resumen dos", publishedAt: new Date("2026-07-22T00:00:00.000Z") }),
    makeNewsDoc({ link: "https://tandil.example/3", title: "Tres", summary: "Resumen tres", publishedAt: new Date("2026-07-23T00:00:00.000Z") }),
    // anterior a la activación: no debe aparecer
    makeNewsDoc({ link: "https://tandil.example/0", title: "Cero", summary: "Anterior", publishedAt: new Date("2026-07-19T00:00:00.000Z") }),
  ]);

  const summary = await runDigestOnce({
    db: mongo.db,
    emailSender,
    now,
    config: defaultNotifierConfig(),
  });

  assert.equal(emailSender.sentMessages.length, 1);
  const message = emailSender.sentMessages[0]!;
  assert.equal(message.to, "persona@example.com");
  for (const title of ["Uno", "Dos", "Tres"]) {
    assert.ok(message.text.includes(title), `falta "${title}" en el mensaje`);
  }
  assert.ok(!message.text.includes("Cero"), "la noticia anterior a la activación no debería aparecer");

  const deliveredCount = await mongo.db.collection("deliveries").countDocuments({ subscriberId: "persona@example.com" });
  assert.equal(deliveredCount, 3);
  assert.equal(summary.messagesSent, 1);
  assert.equal(summary.itemsDelivered, 3);
});

test("dos suscriptores con activatedAt distintos reciben conjuntos distintos en el mismo envío (FR-018)", async () => {
  const now = new Date("2026-07-29T00:00:00.000Z");

  await seedSubscribers(mongo.db, [
    makeSubscriberDoc({
      _id: "temprano@example.com",
      status: "active",
      activatedAt: new Date("2026-07-01T00:00:00.000Z"),
      confirmationTokenHash: "hash-temprano",
      unsubscribeTokenHash: "unsub-hash-temprano",
    }),
    makeSubscriberDoc({
      _id: "tardio@example.com",
      status: "active",
      activatedAt: new Date("2026-07-25T00:00:00.000Z"),
      confirmationTokenHash: "hash-tardio",
      unsubscribeTokenHash: "unsub-hash-tardio",
    }),
  ]);
  await seedNews(mongo.db, [
    makeNewsDoc({ link: "https://tandil.example/vieja", title: "Vieja", summary: "...", publishedAt: new Date("2026-07-10T00:00:00.000Z") }),
    makeNewsDoc({ link: "https://tandil.example/nueva", title: "Nueva", summary: "...", publishedAt: new Date("2026-07-27T00:00:00.000Z") }),
  ]);

  await runDigestOnce({ db: mongo.db, emailSender, now, config: defaultNotifierConfig() });

  assert.equal(emailSender.sentMessages.length, 2);
  const porDestinatario = new Map(emailSender.sentMessages.map((m) => [m.to, m]));

  const temprano = porDestinatario.get("temprano@example.com")!;
  assert.ok(temprano.text.includes("Vieja"));
  assert.ok(temprano.text.includes("Nueva"));

  const tardio = porDestinatario.get("tardio@example.com")!;
  assert.ok(!tardio.text.includes("Vieja"), "activado después de 'Vieja': no debería recibirla");
  assert.ok(tardio.text.includes("Nueva"));
});
