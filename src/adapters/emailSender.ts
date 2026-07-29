/**
 * Contrato entre el núcleo (que construye contenido) y el adaptador (que lo entrega) —
 * Artículo V. El núcleo (`src/core/confirmationEmail.ts`) consume `EmailMessage` solo como
 * tipo, nunca implementa el envío.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** Única operación de entrega; permite un doble en memoria para pruebas (research.md §11). */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Implementación de producción sobre la API HTTP de Resend vía `fetch` nativo, sin el SDK
 * oficial (research.md §1/§2). El núcleo nunca importa este módulo ni conoce que el proveedor
 * es Resend.
 */
export function createResendEmailSender(apiKey: string, senderAddress: string): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await fetch(RESEND_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: senderAddress,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend respondió ${response.status} al intentar enviar un mensaje`);
      }
    },
  };
}
