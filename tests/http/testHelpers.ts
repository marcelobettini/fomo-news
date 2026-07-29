import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import type { NewsDocument } from "../../src/adapters/repository.js";
import type { SubscriberDocument, SuppressionDocument } from "../../src/adapters/subscriberRepository.js";
import type { EmailMessage, EmailSender } from "../../src/adapters/emailSender.js";

export interface TestMongo {
  db: Db;
  uri: string;
  stop(): Promise<void>;
}

/**
 * Levanta una instancia de MongoDB efímera en memoria (research.md §6): sin red hacia Atlas
 * ni hacia la fuente de noticias real. La primera vez descarga el binario de `mongod` de
 * forma perezosa (no requiere el postinstall del paquete).
 */
export async function startTestMongo(): Promise<TestMongo> {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("fomo-news-test");
  return {
    db,
    uri,
    stop: async () => {
      await client.close();
      await mongod.stop();
    },
  };
}

export async function seedNews(db: Db, docs: readonly NewsDocument[]): Promise<void> {
  if (docs.length === 0) return;
  await db.collection<NewsDocument>("news").insertMany([...docs]);
}

export async function clearNews(db: Db): Promise<void> {
  await db.collection("news").deleteMany({});
}

/** Fábrica de `NewsDocument` de prueba con defaults razonables, para no repetir los 9 campos en cada test. */
export function makeNewsDoc(
  overrides: Partial<NewsDocument> & { link: string; publishedAt: Date },
): NewsDocument {
  const now = new Date();
  return {
    _id: overrides.link,
    title: "Título de prueba",
    summary: "Resumen de prueba",
    category: "Policiales",
    updatedAt: overrides.publishedAt,
    firstSeenAt: now,
    expiresAt: new Date(overrides.publishedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

export async function seedSubscribers(db: Db, docs: readonly SubscriberDocument[]): Promise<void> {
  if (docs.length === 0) return;
  await db.collection<SubscriberDocument>("subscribers").insertMany([...docs]);
}

export async function seedSuppressions(db: Db, docs: readonly SuppressionDocument[]): Promise<void> {
  if (docs.length === 0) return;
  await db.collection<SuppressionDocument>("suppressions").insertMany([...docs]);
}

export async function clearSubscribers(db: Db): Promise<void> {
  await db.collection("subscribers").deleteMany({});
  await db.collection("suppressions").deleteMany({});
}

/** Fábrica de `SubscriberDocument` de prueba, para no repetir los campos en cada test. */
export function makeSubscriberDoc(
  overrides: Partial<SubscriberDocument> & { _id: string },
): SubscriberDocument {
  const now = new Date();
  return {
    status: "pending",
    confirmationTokenHash: "test-confirmation-token-hash",
    confirmationTokenExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    unsubscribeTokenHash: "test-unsubscribe-token-hash",
    lastRequestAt: now,
    createdAt: now,
    ...overrides,
  };
}

/**
 * Doble en memoria de `EmailSender` (research.md §11): guarda los mensajes "enviados" en un
 * arreglo, sin ninguna llamada de red, para que los tests HTTP puedan inspeccionar qué se
 * habría enviado.
 */
export interface FakeEmailSender extends EmailSender {
  sentMessages: EmailMessage[];
}

export function makeFakeEmailSender(): FakeEmailSender {
  const sentMessages: EmailMessage[] = [];
  return {
    sentMessages,
    async send(message: EmailMessage): Promise<void> {
      sentMessages.push(message);
    },
  };
}

/**
 * Defaults de la configuración de feature 003 para tests que solo ejercitan `GET /news`
 * (feature 002) y no les importa el resto — evita repetir los 8 campos nuevos de `AppConfig`
 * en cada archivo de test que no los necesita. Reutiliza el mismo `db` en memoria: los tests no
 * dependen de la separación de credenciales real de producción (research.md §4).
 */
export function defaultSubscriberAppConfig(db: Db): {
  subscribersDb: Db;
  emailSender: FakeEmailSender;
  publicBaseUrl: string;
  confirmationTokenTtlMs: number;
  signupResendCooldownMs: number;
  signupRateLimitMaxPerIp: number;
  signupRateLimitWindowMs: number;
  emailWebhookSigningSecret: string;
  emailSuppressionHashSecret: string;
} {
  return {
    subscribersDb: db,
    emailSender: makeFakeEmailSender(),
    publicBaseUrl: "https://noticias.tandil.example",
    confirmationTokenTtlMs: 24 * 60 * 60 * 1000,
    signupResendCooldownMs: 60_000,
    signupRateLimitMaxPerIp: 10_000,
    signupRateLimitWindowMs: 60_000,
    emailWebhookSigningSecret: "test-webhook-signing-secret",
    emailSuppressionHashSecret: "test-suppression-hash-secret",
  };
}
