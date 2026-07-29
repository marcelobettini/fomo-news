import type { EmailMessage } from "../adapters/emailSender.js";

export interface ConfirmationEmailParams {
  to: string;
  confirmationUrl: string;
  unsubscribeUrl: string;
}

/**
 * Construcción pura del mensaje de confirmación de alta (Artículo V — sin I/O, sin conocer el
 * proveedor de entrega). Incluye el enlace de baja desde el primer mensaje enviado, tanto en el
 * cuerpo como en los encabezados `List-Unsubscribe`/`List-Unsubscribe-Post` (RFC 8058,
 * research.md §8/§10).
 */
export function buildConfirmationEmail(params: ConfirmationEmailParams): EmailMessage {
  const { to, confirmationUrl, unsubscribeUrl } = params;
  return {
    to,
    subject: "Confirmá tu suscripción a las noticias de Tandil",
    text:
      `Para confirmar tu suscripción, abrí este enlace:\n${confirmationUrl}\n\n` +
      `Si no solicitaste esta suscripción, ignorá este mensaje o date de baja acá:\n${unsubscribeUrl}`,
    html:
      `<p>Para confirmar tu suscripción, hacé clic en el siguiente enlace:</p>` +
      `<p><a href="${confirmationUrl}">${confirmationUrl}</a></p>` +
      `<p>Si no solicitaste esta suscripción, ignorá este mensaje o` +
      ` <a href="${unsubscribeUrl}">date de baja acá</a>.</p>`,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
