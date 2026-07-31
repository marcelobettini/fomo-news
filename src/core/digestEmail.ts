import type { EmailMessage } from "../adapters/emailSender.js";

export interface DigestNewsItem {
  title: string;
  summary: string;
  link: string;
}

export interface DigestEmailParams {
  to: string;
  items: readonly DigestNewsItem[];
  unsubscribeUrl: string;
  /** `true` si `items` no incluye todo lo pendiente (tope por mensaje, FR-009). */
  truncated: boolean;
  /** Consulta pública de noticias, referenciada cuando `truncated` es `true`. */
  publicNewsUrl: string;
}

/**
 * Construcción pura del resumen periódico (Artículo V/VIII — sin I/O, sin conocer el
 * proveedor de entrega, sin generar ni reescribir contenido): título, resumen tal como lo
 * publica la fuente y enlace original por cada noticia (FR-008). Mismo molde que
 * `confirmationEmail.ts` — enlace de baja desde el primer mensaje, tanto en el cuerpo como en
 * los encabezados `List-Unsubscribe`/`List-Unsubscribe-Post` (RFC 8058).
 */
export function buildDigestEmail(params: DigestEmailParams): EmailMessage {
  const { to, items, unsubscribeUrl, truncated, publicNewsUrl } = params;

  const textItems = items.map((item) => `${item.title}\n${item.summary}\n${item.link}`).join("\n\n");
  const htmlItems = items
    .map(
      (item) =>
        `<li><strong>${item.title}</strong><p>${item.summary}</p><p><a href="${item.link}">${item.link}</a></p></li>`,
    )
    .join("\n");

  const truncationTextNote = truncated
    ? `\n\nHay más noticias disponibles — consultalas en:\n${publicNewsUrl}`
    : "";
  const truncationHtmlNote = truncated
    ? `<p>Hay más noticias disponibles — <a href="${publicNewsUrl}">consultalas acá</a>.</p>`
    : "";

  return {
    to,
    subject: "Noticias de Tandil",
    text:
      `${textItems}${truncationTextNote}\n\n` +
      `Para dejar de recibir estos correos, abrí este enlace:\n${unsubscribeUrl}`,
    html:
      `<ul>${htmlItems}</ul>` +
      truncationHtmlNote +
      `<p><a href="${unsubscribeUrl}">Dejar de recibir estos correos</a></p>`,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
