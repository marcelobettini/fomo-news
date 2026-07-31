/** Campos mínimos de una noticia necesarios para decidir elegibilidad/orden (data-model.md). */
export interface DigestNewsCandidate {
  newsId: string;
  publishedAt: Date;
}

/**
 * Una noticia es elegible para un suscriptor si se publicó después de su activación y no es
 * más antigua que el vencimiento máximo configurado (FR-002/FR-018). La categoría no se
 * evalúa acá: `news` ya contiene únicamente la categoría objetivo (el ingestor filtra antes de
 * escribir), mismo razonamiento que `newsReader.ts` de la feature 2.
 */
export function isNewsEligible(
  news: DigestNewsCandidate,
  subscriberActivatedAt: Date,
  maxPendingAgeMs: number,
  now: Date,
): boolean {
  return (
    news.publishedAt.getTime() > subscriberActivatedAt.getTime() &&
    now.getTime() - news.publishedAt.getTime() <= maxPendingAgeMs
  );
}

/**
 * Resta en memoria contra el registro de entregas ya confirmadas — nunca una marca de agua
 * temporal (Artículo I, research.md §4 de specs/004-send-email-news/). El volumen esperado
 * (decenas de noticias, pocos suscriptores) hace innecesaria una agregación de Mongo.
 */
export function selectPendingNews<T extends DigestNewsCandidate>(
  eligible: readonly T[],
  deliveredNewsIds: ReadonlySet<string>,
): T[] {
  return eligible.filter((news) => !deliveredNewsIds.has(news.newsId));
}

export interface MessageSelection<T> {
  included: T[];
  /** `true` si `pendingSortedByPublishedDesc` tenía más elementos que `maxPerMessage` (FR-009). */
  truncated: boolean;
}

/**
 * Tope de noticias por mensaje: si lo pendiente excede `maxPerMessage`, se incluyen solo las
 * más recientes (FR-009). Los elementos excluidos no se tocan acá — quien llame a esta función
 * NO DEBE registrarlos como entregados; siguen pendientes para una corrida siguiente si
 * continúan siendo elegibles (data-model.md de specs/004-send-email-news/).
 */
export function selectForMessage<T>(
  pendingSortedByPublishedDesc: readonly T[],
  maxPerMessage: number,
): MessageSelection<T> {
  if (pendingSortedByPublishedDesc.length <= maxPerMessage) {
    return { included: [...pendingSortedByPublishedDesc], truncated: false };
  }
  return { included: pendingSortedByPublishedDesc.slice(0, maxPerMessage), truncated: true };
}
