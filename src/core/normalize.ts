/** Colapsa espacios en blanco y saltos de línea; no reescribe ni recorta contenido (Artículo VIII). */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * La fuente antepone la imagen de portada al resumen como `<figure><img .../></figure>`
 * (a veces una etiqueta `<img>` suelta); ambas formas son "la imagen inicial" a efectos de
 * FR-003. Patrón acotado a esas dos formas conocidas, no un parser HTML de propósito general
 * (research.md §14).
 */
const LEADING_IMAGE_MARKUP = /^\s*(?:<figure\b[^>]*>[\s\S]*?<\/figure>|<img\b[^>]*\/?>)\s*/i;

/**
 * Elimina únicamente la imagen inicial del resumen (envuelta en <figure> o como <img> suelto),
 * si existe. El resto del resumen se conserva tal como lo publica la fuente (Artículo VIII: sin
 * reescritura de contenido).
 */
export function stripLeadingImage(summaryHtml: string): string {
  return summaryHtml.replace(LEADING_IMAGE_MARKUP, "");
}
