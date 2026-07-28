import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, type Db } from "mongodb";
import type { NewsDocument } from "../../src/adapters/repository.js";

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
