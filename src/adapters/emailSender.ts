import nodemailer from "nodemailer";

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

/**
 * Resultado de un intento de envío (contracts/email-sender-contract.md de
 * specs/004-send-email-news/): `"confirmed"` el canal confirmó explícitamente la entrega;
 * `"failed"` el canal la rechazó explícitamente; `"ambiguous"` no hubo respuesta clara (sin
 * red, timeout) — se trata igual que `"failed"` a los efectos de registrar la entrega, nunca
 * se asume éxito ante la duda. Propiedad genérica de "enviar por HTTP", no específica de
 * ningún consumidor (research.md §7) — el resumen periódico de noticias (feature 004) la
 * necesita para decidir cuándo registrar una entrega; el alta de suscriptores (feature 3) la
 * usa igual que antes usaba una excepción.
 */
export type EmailSendResult = "confirmed" | "failed" | "ambiguous";

/** Única operación de entrega; permite un doble en memoria para pruebas (research.md §11). */
export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

const RESEND_API_URL = "https://api.resend.com/emails";

/**
 * Implementación de producción sobre la API HTTP de Resend vía `fetch` nativo, sin el SDK
 * oficial (research.md §1/§2). El núcleo nunca importa este módulo ni conoce que el proveedor
 * es Resend. Clasifica el resultado en vez de lanzar: respuesta con `response.ok` →
 * `"confirmed"`; respuesta HTTP sin `ok` (Resend rechazó explícitamente) → `"failed"`;
 * `fetch()` lanza (sin red, timeout, sin respuesta) → `"ambiguous"`.
 */
export function createResendEmailSender(apiKey: string, senderAddress: string): EmailSender {
  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      let response: Response;
      try {
        response = await fetch(RESEND_API_URL, {
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
      } catch {
        return "ambiguous";
      }
      return response.ok ? "confirmed" : "failed";
    },
  };
}

/**
 * Implementación de producción sobre SMTP vía Nodemailer (prueba de concepto de investigación
 * SDD — reemplaza a Resend en las corridas reales de este experimento, `createResendEmailSender`
 * queda intacto por si se retoma). Clasifica igual que el sender de Resend: `sendMail` resuelve
 * y ningún destinatario fue rechazado → `"confirmed"`; resuelve pero el destinatario está en
 * `rejected` → `"failed"`; `sendMail` lanza (sin red, auth SMTP inválida, timeout) → `"ambiguous"`.
 */
export function createNodemailerEmailSender(
  smtpHost: string,
  smtpPort: number,
  smtpUser: string,
  smtpPass: string,
  senderAddress: string,
): EmailSender {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      let info: Awaited<ReturnType<typeof transporter.sendMail>>;
      try {
        info = await transporter.sendMail({
          from: senderAddress,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
        });
      } catch {
        return "ambiguous";
      }
      return info.rejected.length === 0 ? "confirmed" : "failed";
    },
  };
}

/**
 * `EmailSender` de desarrollo local: no llama a ningún proveedor, solo imprime el mensaje
 * completo (incluye los enlaces de confirmación/baja con su token) para copiarlo a mano en
 * Insomnia/curl. Uso exclusivo de `src/devServer.ts`/`src/devNotifier.ts` — nunca en
 * producción. Siempre devuelve `"confirmed"`: nunca hay nada ambiguo al imprimir por consola.
 */
export function createConsoleEmailSender(): EmailSender {
  return {
    async send(message: EmailMessage): Promise<EmailSendResult> {
      console.log("\n----- correo simulado (no enviado) -----");
      console.log(`Para: ${message.to}`);
      console.log(`Asunto: ${message.subject}`);
      console.log(message.text);
      console.log("-----------------------------------------\n");
      return "confirmed";
    },
  };
}
