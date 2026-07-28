import type { Db } from "mongodb";

const LOCK_ID = "ingestor";
/** Respaldo ante un proceso caído que no llegó a liberar el lock; no es el mecanismo principal. */
const LOCK_TTL_MS = 10 * 60 * 1000;

interface LockDocument {
  _id: string;
  acquiredAt: Date;
  expiresAt: Date;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Adquiere el lock de exclusión mutua. Devuelve `false` (sin lanzar) si ya hay una corrida en
 * curso — eso no es un fallo, es una corrida omitida (contracts/cli-contract.md).
 */
export async function acquireLock(db: Db): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  try {
    await db
      .collection<LockDocument>("locks")
      .findOneAndUpdate(
        { _id: LOCK_ID, expiresAt: { $lte: now } },
        { $set: { acquiredAt: now, expiresAt } },
        { upsert: true },
      );
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return false;
    }
    throw error;
  }
}

export async function releaseLock(db: Db): Promise<void> {
  await db.collection<LockDocument>("locks").deleteOne({ _id: LOCK_ID });
}

/** TTL de respaldo sobre `expiresAt`, independiente de la liberación explícita en `finally`. */
export async function ensureLockIndexes(db: Db): Promise<void> {
  await db.collection<LockDocument>("locks").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}
