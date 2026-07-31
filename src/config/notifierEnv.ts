import { isValidIanaTimeZone } from "../core/localTime.js";
import { assertRetentionCoherent } from "../core/retentionCoherence.js";
import { requireString, requirePositiveInt, requirePositiveIntMs, type EnvLike } from "./env.js";

/** Configuración del proceso de envío periódico de noticias (feature 004). */
export interface NotifierEnvConfig {
  mongoNotifierUri: string;
  timeZone: string;
  publicBaseUrl: string;
  /** SMTP (prueba de concepto Nodemailer, reemplaza a Resend para esta investigación). */
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  emailSenderAddress: string;
  /** Secreto compartido con `.env.server` (research.md §8). */
  unsubscribeTokenSecret: string;
  /** Hora local "HH:MM", inicio de la ventana horaria permitida (FR-005). */
  sendWindowStartLocal: string;
  /** Hora local "HH:MM", fin de la ventana horaria permitida; se asume >= al inicio. */
  sendWindowEndLocal: string;
  /** Vencimiento máximo de antigüedad (ms) para que una noticia siga siendo elegible (FR-002). */
  maxPendingAgeMs: number;
  /** Tope de noticias por mensaje (FR-009). */
  maxNewsPerMessage: number;
  /** Intervalo máximo esperado (ms) entre corridas — solo para la validación de coherencia (research.md §6). */
  maxSendIntervalMs: number;
  /** Retención de noticias del ingestor (ms), duplicada acá para la misma validación. */
  newsRetentionMs: number;
}

const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireLocalTime(env: EnvLike, name: string): string {
  const value = requireString(env, name);
  if (!LOCAL_TIME_PATTERN.test(value)) {
    throw new Error(`La variable de entorno ${name} debe tener formato "HH:MM" (24 horas), recibido: "${value}"`);
  }
  return value;
}

/**
 * Carga y valida la configuración del notifier; lanza si falta o es inválida alguna variable
 * requerida, o si la relación entre `newsRetentionMs`, `maxSendIntervalMs` y `maxPendingAgeMs`
 * es incoherente (Artículo I, research.md §6 de specs/004-send-email-news/) — antes de que
 * `main()` (`src/notifier.ts`) llegue a conectar a Mongo con una configuración insegura.
 */
export function loadNotifierEnvConfig(env: EnvLike = process.env as EnvLike): NotifierEnvConfig {
  const timeZone = requireString(env, "TIMEZONE");
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(
      `TIMEZONE debe ser un nombre de zona IANA válido (ej. "America/Argentina/Buenos_Aires"), recibido: "${timeZone}"`,
    );
  }
  const maxPendingAgeMs = requirePositiveIntMs(env, "MAX_PENDING_AGE_MS");
  const maxSendIntervalMs = requirePositiveIntMs(env, "MAX_SEND_INTERVAL_MS");
  const newsRetentionMs = requirePositiveIntMs(env, "NEWS_RETENTION_MS");
  assertRetentionCoherent({ newsRetentionMs, maxSendIntervalMs, maxPendingAgeMs });

  return {
    mongoNotifierUri: requireString(env, "MONGODB_NOTIFIER_URI"),
    timeZone,
    publicBaseUrl: requireString(env, "PUBLIC_BASE_URL"),
    smtpHost: requireString(env, "SMTP_HOST"),
    smtpPort: requirePositiveInt(env, "SMTP_PORT"),
    smtpUser: requireString(env, "SMTP_USER"),
    smtpPass: requireString(env, "SMTP_PASS"),
    emailSenderAddress: requireString(env, "EMAIL_SENDER_ADDRESS"),
    unsubscribeTokenSecret: requireString(env, "UNSUBSCRIBE_TOKEN_SECRET"),
    sendWindowStartLocal: requireLocalTime(env, "SEND_WINDOW_START_LOCAL"),
    sendWindowEndLocal: requireLocalTime(env, "SEND_WINDOW_END_LOCAL"),
    maxPendingAgeMs,
    maxNewsPerMessage: requirePositiveInt(env, "MAX_NEWS_PER_MESSAGE"),
    maxSendIntervalMs,
    newsRetentionMs,
  };
}
