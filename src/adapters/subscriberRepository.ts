import { createHmac } from "node:crypto";
import type { Db } from "mongodb";
import { connect as connectGeneric, type RepositoryHandle } from "./repository.js";
import { DELIVERIES_COLLECTION } from "./deliveryRepository.js";

/** Ciclo de vida del documento de suscriptor (data-model.md); eliminado por completo al darse de baja. */
export interface SubscriberDocument {
  _id: string;
  status: "pending" | "active";
  confirmationTokenHash: string;
  confirmationTokenExpiresAt?: Date;
  unsubscribeTokenHash: string;
  lastRequestAt: Date;
  activatedAt?: Date;
  createdAt: Date;
}

export type SuppressionReason = "unsubscribed" | "hard_bounce" | "complaint";

/** Rastro mínimo no reversible que sobrevive a la baja (data-model.md). */
export interface SuppressionDocument {
  _id: string;
  reason: SuppressionReason;
  suppressedAt: Date;
}

const SUBSCRIBERS_COLLECTION = "subscribers";
const SUPPRESSIONS_COLLECTION = "suppressions";

/**
 * Conexión de lectura-escritura acotada a `subscribers`/`suppressions` vía
 * `MONGODB_SUBSCRIBERS_URI` (research.md §4), reutilizando el `connect()` genérico de
 * `src/adapters/repository.ts` — no exclusivo del ingestor.
 */
export async function connect(mongoSubscribersUri: string): Promise<RepositoryHandle> {
  return connectGeneric(mongoSubscribersUri);
}

/**
 * Índices de `subscribers`: TTL sobre `confirmationTokenExpiresAt` (housekeeping de pendientes
 * abandonados, research.md §5 — Mongo ignora el TTL en documentos sin el campo, que es el caso
 * una vez activados), y únicos sobre los dos hashes de token (búsqueda O(1) y colisión
 * irrepresentable en la base).
 */
export async function ensureSubscriberIndexes(db: Db): Promise<void> {
  const collection = db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION);
  await collection.createIndex({ confirmationTokenExpiresAt: 1 }, { expireAfterSeconds: 0 });
  await collection.createIndex({ confirmationTokenHash: 1 }, { unique: true });
  await collection.createIndex({ unsubscribeTokenHash: 1 }, { unique: true });
}

export async function findByEmail(db: Db, email: string): Promise<SubscriberDocument | null> {
  return db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION).findOne({ _id: email });
}

/**
 * Suscriptores activos, para el cálculo de pendientes del resumen periódico (feature 004,
 * FR-017): un suscriptor no activo (`pending`, dado de baja o eliminado por señal negativa del
 * canal) nunca recibe un envío, aunque tenga noticias elegibles.
 */
export interface ActiveSubscriber {
  _id: string;
  /** Siempre presente: la consulta ya filtra `status === "active"` (data-model.md). */
  activatedAt: Date;
}

export async function getActiveSubscribers(db: Db): Promise<ActiveSubscriber[]> {
  const docs = await db
    .collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION)
    .find({ status: "active" }, { projection: { activatedAt: 1 } })
    .toArray();
  return docs.map((doc) => ({ _id: doc._id, activatedAt: doc.activatedAt as Date }));
}

export async function findByConfirmationTokenHash(
  db: Db,
  confirmationTokenHash: string,
): Promise<SubscriberDocument | null> {
  return db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION).findOne({ confirmationTokenHash });
}

export async function findByUnsubscribeTokenHash(
  db: Db,
  unsubscribeTokenHash: string,
): Promise<SubscriberDocument | null> {
  return db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION).findOne({ unsubscribeTokenHash });
}

export interface CreatePendingParams {
  email: string;
  confirmationTokenHash: string;
  confirmationTokenExpiresAt: Date;
  unsubscribeTokenHash: string;
  now: Date;
}

/** `(sin documento) → pending` (FR-001/FR-002/FR-011/FR-012): alta nueva o tras baja/vencimiento previo. */
export async function createPending(db: Db, params: CreatePendingParams): Promise<void> {
  const doc: SubscriberDocument = {
    _id: params.email,
    status: "pending",
    confirmationTokenHash: params.confirmationTokenHash,
    confirmationTokenExpiresAt: params.confirmationTokenExpiresAt,
    unsubscribeTokenHash: params.unsubscribeTokenHash,
    lastRequestAt: params.now,
    createdAt: params.now,
  };
  await db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION).insertOne(doc);
}

export interface ReissueConfirmationTokenParams {
  email: string;
  confirmationTokenHash: string;
  confirmationTokenExpiresAt: Date;
  now: Date;
}

/**
 * `pending → pending` tras cooldown vencido (FR-015, research.md §6): reemplaza el token de
 * confirmación vigente y actualiza `lastRequestAt`. `unsubscribeTokenHash` NO se toca: desde
 * que se deriva de forma determinística (`deriveUnsubscribeToken`,
 * specs/004-send-email-news/research.md §8) es el mismo valor para una misma dirección
 * siempre, así que no hace falta rotarlo ni reenviarlo — el enlace de baja de cualquier mensaje
 * previo sigue siendo válido.
 */
export async function reissueConfirmationToken(
  db: Db,
  params: ReissueConfirmationTokenParams,
): Promise<void> {
  await db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION).updateOne(
    { _id: params.email },
    {
      $set: {
        confirmationTokenHash: params.confirmationTokenHash,
        confirmationTokenExpiresAt: params.confirmationTokenExpiresAt,
        lastRequestAt: params.now,
      },
    },
  );
}

/** `pending → active` (FR-006): fija `activatedAt` y quita el vencimiento (deja de aplicar el TTL). */
export async function activate(db: Db, email: string, now: Date): Promise<void> {
  await db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION).updateOne(
    { _id: email },
    {
      $set: { status: "active", activatedAt: now },
      $unset: { confirmationTokenExpiresAt: "" },
    },
  );
}

export interface DeleteAndSuppressParams {
  email: string;
  reason: SuppressionReason;
  now: Date;
  hmacSecret: string;
}

/**
 * `{pending, active} → (sin documento)` (FR-010/FR-012/FR-013): elimina el documento y registra
 * un identificador HMAC no reversible y no derivable del correo (research.md §7) — nunca el
 * correo en claro. `upsert` porque una misma dirección puede volver a suscribirse y ser
 * suprimida más de una vez a lo largo del tiempo.
 *
 * También elimina el historial de entregas del suscriptor en `deliveries` (feature 004,
 * FR-019): esa colección pertenece al ámbito de `MONGODB_NOTIFIER_URI`, distinto de la
 * credencial que usa este módulo (`MONGODB_SUBSCRIBERS_URI`) — el rol de esta última se amplía
 * explícitamente para permitir `deleteMany` sobre `deliveries`, y solo eso
 * (specs/004-send-email-news/research.md §9), para que la baja de datos personales sea
 * inmediata y no dependa de que el notifier corra de nuevo.
 */
export async function deleteAndSuppress(db: Db, params: DeleteAndSuppressParams): Promise<void> {
  const suppressionId = createHmac("sha256", params.hmacSecret).update(params.email).digest("hex");
  await db.collection<SubscriberDocument>(SUBSCRIBERS_COLLECTION).deleteOne({ _id: params.email });
  await db.collection(DELIVERIES_COLLECTION).deleteMany({ subscriberId: params.email });
  await db.collection<SuppressionDocument>(SUPPRESSIONS_COLLECTION).updateOne(
    { _id: suppressionId },
    { $set: { reason: params.reason, suppressedAt: params.now } },
    { upsert: true },
  );
}
