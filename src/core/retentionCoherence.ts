export interface RetentionCoherenceParams {
  newsRetentionMs: number;
  maxSendIntervalMs: number;
  maxPendingAgeMs: number;
}

/**
 * Invariante que sostiene la resolución elegida para el conflicto entre la purga automática de
 * `news` (índice TTL ciego, feature 1) y la garantía de no perder una noticia pendiente de
 * entrega (FR-020, research.md §6 de specs/004-send-email-news/): para cuando el TTL purgaría
 * una noticia, ya tuvo que haber pasado al menos un envío dentro de la ventana permitida
 * después de que esa noticia dejó de ser elegible por antigüedad — momento en el que deja de
 * contar como "pendiente" para cualquier suscriptor. Se verifica en tiempo de ejecución, al
 * arrancar el proceso, en vez de confiarse solo a la documentación.
 */
export function assertRetentionCoherent(params: RetentionCoherenceParams): void {
  const { newsRetentionMs, maxSendIntervalMs, maxPendingAgeMs } = params;
  if (newsRetentionMs <= maxSendIntervalMs + maxPendingAgeMs) {
    throw new Error(
      "Configuración de retención incoherente: NEWS_RETENTION_MS debe ser estrictamente mayor " +
        `que MAX_SEND_INTERVAL_MS + MAX_PENDING_AGE_MS (recibido: NEWS_RETENTION_MS=${newsRetentionMs}, ` +
        `MAX_SEND_INTERVAL_MS=${maxSendIntervalMs}, MAX_PENDING_AGE_MS=${maxPendingAgeMs}) — con esta ` +
        "relación, el TTL de `news` podría purgar una noticia todavía pendiente de entrega (Artículo I).",
    );
  }
}
