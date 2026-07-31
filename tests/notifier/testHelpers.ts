import type { Db } from "mongodb";
import {
  startTestMongo,
  makeNewsDoc,
  seedNews,
  makeSubscriberDoc,
  seedSubscribers,
  makeFakeEmailSender,
  type TestMongo,
  type FakeEmailSender,
} from "../http/testHelpers.js";
import { ensureDeliveryIndexes, recordDelivery, DELIVERIES_COLLECTION } from "../../src/adapters/deliveryRepository.js";
import { ensureLockIndexes } from "../../src/adapters/lock.js";
import { ensureSubscriberIndexes } from "../../src/adapters/subscriberRepository.js";
import type { NotifierEnvConfig } from "../../src/config/notifierEnv.js";

export { startTestMongo, makeNewsDoc, seedNews, makeSubscriberDoc, seedSubscribers, makeFakeEmailSender };
export type { TestMongo, FakeEmailSender };

/**
 * Levanta el mismo Mongo efímero en memoria que `tests/http/testHelpers.ts` (research.md §13
 * de specs/004-send-email-news/) y asegura los índices que `runDigestOnce` da por existentes
 * (`deliveries`, `locks`, `subscribers`) — mismo mecanismo que las features 2/3, sin red hacia
 * Atlas.
 */
export async function startNotifierTestMongo(): Promise<TestMongo> {
  const mongo = await startTestMongo();
  await ensureDeliveryIndexes(mongo.db);
  await ensureLockIndexes(mongo.db);
  await ensureSubscriberIndexes(mongo.db);
  return mongo;
}

export interface SeedDeliveryParams {
  subscriberId: string;
  newsId: string;
  deliveredAt: Date;
}

/** Siembra un registro de entrega ya confirmada, para tests que parten de un estado previo. */
export async function seedDelivery(db: Db, params: SeedDeliveryParams): Promise<void> {
  await recordDelivery(db, {
    subscriberId: params.subscriberId,
    newsId: params.newsId,
    channel: "email",
    deliveredAt: params.deliveredAt,
  });
}

export async function countDeliveries(db: Db, subscriberId: string): Promise<number> {
  return db.collection(DELIVERIES_COLLECTION).countDocuments({ subscriberId });
}

/**
 * Configuración de notifier con defaults razonables para tests que no ejercitan una variable
 * en particular — evita repetir las once variables en cada archivo de test que no las necesita
 * (mismo criterio que `defaultSubscriberAppConfig` de `tests/http/testHelpers.ts`).
 */
export function defaultNotifierConfig(overrides?: Partial<NotifierEnvConfig>): NotifierEnvConfig {
  return {
    mongoNotifierUri: "unused-in-tests",
    timeZone: "America/Argentina/Buenos_Aires",
    publicBaseUrl: "https://noticias.tandil.example",
    smtpHost: "unused-in-tests",
    smtpPort: 587,
    smtpUser: "unused-in-tests",
    smtpPass: "unused-in-tests",
    emailSenderAddress: "noticias@tandil.example",
    unsubscribeTokenSecret: "test-unsubscribe-token-secret",
    sendWindowStartLocal: "00:00",
    sendWindowEndLocal: "23:59",
    maxPendingAgeMs: 30 * 24 * 60 * 60 * 1000,
    maxNewsPerMessage: 20,
    maxSendIntervalMs: 6 * 60 * 60 * 1000,
    // Coherente con retentionCoherence.ts (research.md §6): estrictamente mayor que
    // maxSendIntervalMs + maxPendingAgeMs, aunque `runDigestOnce` no valida esta relación por
    // sí solo (la valida `loadNotifierEnvConfig`, ver tests/unit/notifierEnv.test.ts).
    newsRetentionMs: 60 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}
