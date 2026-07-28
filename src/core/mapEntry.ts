import type { RawEntry } from "../adapters/source.js";
import { normalizeWhitespace, stripLeadingImage } from "./normalize.js";

/** Los seis campos de negocio de una noticia (spec.md FR-003), antes de bookkeeping interno. */
export interface MappedNews {
  link: string;
  title: string;
  summary: string;
  category: string;
  publishedAt: Date;
  updatedAt: Date;
  /** publishedAt + retención configurada; alimenta el índice TTL (FR-008/FR-009). */
  expiresAt: Date;
}

export function mapEntryToNews(entry: RawEntry, retentionMs: number): MappedNews {
  return {
    link: entry.link,
    title: normalizeWhitespace(entry.title),
    summary: stripLeadingImage(entry.summaryHtml),
    category: normalizeWhitespace(entry.declaredCategory),
    publishedAt: entry.publishedAt,
    updatedAt: entry.updatedAt ?? entry.publishedAt,
    expiresAt: new Date(entry.publishedAt.getTime() + retentionMs),
  };
}

/**
 * Compara la categoría declarada contra la categoría de la ruta del enlace (ambas ya
 * extraídas por el adaptador de fuente). Una discrepancia es una señal de anomalía, no
 * bloquea el almacenamiento ni escala a alarma de pérdida (FR-011).
 */
export function detectCategoryMismatch(entry: RawEntry): boolean {
  if (!entry.linkPathCategory) return false;
  const declared = normalizeWhitespace(entry.declaredCategory).toLowerCase();
  const fromLink = normalizeWhitespace(entry.linkPathCategory).toLowerCase();
  return declared !== fromLink;
}
