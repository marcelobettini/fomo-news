/** Colapsa espacios en blanco y saltos de línea; no reescribe ni recorta contenido (Artículo VIII). */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const LEADING_IMG_TAG = /^\s*<img\b[^>]*\/?>\s*/i;

/**
 * Elimina únicamente la etiqueta <img> inicial del resumen, si existe. El resto del resumen
 * se conserva tal como lo publica la fuente (Artículo VIII: sin reescritura de contenido).
 */
export function stripLeadingImage(summaryHtml: string): string {
  return summaryHtml.replace(LEADING_IMG_TAG, "");
}
