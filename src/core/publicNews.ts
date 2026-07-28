import type { NewsDocument } from "../adapters/repository.js";

/**
 * Forma pública de una noticia (feature 002, FR-003): solo los 4 campos expuestos. Nunca
 * incluye categoría (siempre la configurada) ni ningún dato interno de bookkeeping del
 * sistema de captura (Artículo III).
 */
export interface PublicNews {
  title: string;
  summary: string;
  link: string;
  publishedAt: string;
}

/**
 * Mapeo puro `NewsDocument` → `PublicNews`. El resumen y el título ya vienen normalizados y
 * limpios de imagen inicial por el ingestor (feature 001); esta función NUNCA reescribe
 * contenido (Artículo VIII), solo selecciona y serializa los campos a exponer.
 */
export function toPublicNews(doc: NewsDocument): PublicNews {
  return {
    title: doc.title,
    summary: doc.summary,
    link: doc.link,
    publishedAt: doc.publishedAt.toISOString(),
  };
}
