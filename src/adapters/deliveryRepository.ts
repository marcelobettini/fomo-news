import { ObjectId, type Db } from "mongodb";
import { isDuplicateKeyError } from "./lock.js";

export const DELIVERIES_COLLECTION = "deliveries";

/**
 * Un documento por combinación efectivamente entregada de noticia/suscriptor/canal
 * (data-model.md de specs/004-send-email-news/). Su existencia es lo que hace que una noticia
 * deje de estar pendiente para ese suscriptor; nunca se actualiza, solo se crea o se borra al
 * eliminarse el suscriptor (`subscriberRepository.deleteAndSuppress`).
 */
export interface DeliveryDocument {
  _id: ObjectId;
  subscriberId: string;
  newsId: string;
  channel: "email";
  deliveredAt: Date;
}

/**
 * Índice único compuesto: hace irrepresentable un segundo registro para la misma combinación a
 * nivel de motor, en vez de depender de que el código lo verifique (research.md §3). Cubre
 * también, como prefijo, la consulta de borrado en cascada por `subscriberId`
 * (`deleteAndSuppress`, research.md §9) — no hace falta un índice separado para eso.
 */
export async function ensureDeliveryIndexes(db: Db): Promise<void> {
  await db
    .collection<DeliveryDocument>(DELIVERIES_COLLECTION)
    .createIndex({ subscriberId: 1, newsId: 1, channel: 1 }, { unique: true });
}

export interface RecordDeliveryParams {
  subscriberId: string;
  newsId: string;
  channel: "email";
  deliveredAt: Date;
}

/**
 * Registra una entrega confirmada. Un intento de registrar una combinación ya existente no
 * lanza — se trata como éxito idempotente (mismo patrón que `lock.ts` ante `acquireLock`),
 * necesario para que ejecuciones duplicadas no fallen ni dupliquen nada (FR-013).
 */
export async function recordDelivery(db: Db, params: RecordDeliveryParams): Promise<void> {
  try {
    await db.collection<DeliveryDocument>(DELIVERIES_COLLECTION).insertOne({
      _id: new ObjectId(),
      subscriberId: params.subscriberId,
      newsId: params.newsId,
      channel: params.channel,
      deliveredAt: params.deliveredAt,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return;
    }
    throw error;
  }
}

/** Identificadores de noticias ya entregadas a un suscriptor por un canal (research.md §4). */
export async function getDeliveredNewsIds(
  db: Db,
  subscriberId: string,
  channel: "email",
): Promise<Set<string>> {
  const docs = await db
    .collection<DeliveryDocument>(DELIVERIES_COLLECTION)
    .find({ subscriberId, channel }, { projection: { newsId: 1 } })
    .toArray();
  return new Set(docs.map((doc) => doc.newsId));
}
