import { isValidIanaTimeZone } from "../core/localTime.js";
import { requireString, requirePositiveInt, requirePositiveIntMs, type EnvLike } from "./env.js";

/** Configuración del proceso HTTP (feature 002 solo lectura + feature 003 suscriptores). */
export interface ServerEnvConfig {
  mongoReadonlyUri: string;
  timeZone: string;
  port: number;
  rateLimitMaxPerIp: number;
  rateLimitWindowMs: number;
  /** TTL (ms) de la caché en memoria del conjunto del día (research.md §3). */
  cacheTtlMs: number;
  /** Credencial acotada a `subscribers`/`suppressions` (feature 003, research.md §4). */
  mongoSubscribersUri: string;
  /** Base para construir los enlaces de confirmación y de baja embebidos en los mensajes. */
  publicBaseUrl: string;
  /** Clave de la API de Resend (research.md §1/§2 de specs/003-subscriber-lifecycle/). */
  emailProviderApiKey: string;
  /** Remitente verificado del dominio propio (research.md §9 de specs/003-subscriber-lifecycle/). */
  emailSenderAddress: string;
  /** Secreto de verificación de firma de webhooks (esquema Svix, research.md §3). */
  emailWebhookSigningSecret: string;
  /** Secreto del HMAC de `suppressions._id`, distinto del anterior (research.md §7). */
  emailSuppressionHashSecret: string;
  /**
   * Secreto compartido con `.env.notifier` para derivar de forma determinística el token de
   * baja (specs/004-send-email-news/research.md §8). Distinto de los dos secretos anteriores.
   */
  unsubscribeTokenSecret: string;
  /** Vencimiento (ms) del token de confirmación de alta (FR-003/FR-005). */
  confirmationTokenTtlMs: number;
  /** Cooldown (ms) de reenvío / límite de tasa por dirección de destino (research.md §6). */
  signupResendCooldownMs: number;
  /** Límite de tasa por IP específico de `POST /subscribers` (FR-016). */
  signupRateLimitMaxPerIp: number;
  /** Ventana (ms) del límite de tasa anterior. */
  signupRateLimitWindowMs: number;
}

/** Carga y valida la configuración del endpoint; lanza si falta o es inválida alguna variable. */
export function loadServerEnvConfig(env: EnvLike = process.env as EnvLike): ServerEnvConfig {
  const timeZone = requireString(env, "TIMEZONE");
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(
      `TIMEZONE debe ser un nombre de zona IANA válido (ej. "America/Argentina/Buenos_Aires"), recibido: "${timeZone}"`,
    );
  }
  return {
    mongoReadonlyUri: requireString(env, "MONGODB_READONLY_URI"),
    timeZone,
    port: requirePositiveInt(env, "PORT"),
    rateLimitMaxPerIp: requirePositiveInt(env, "RATE_LIMIT_MAX_PER_IP"),
    rateLimitWindowMs: requirePositiveIntMs(env, "RATE_LIMIT_WINDOW_MS"),
    cacheTtlMs: requirePositiveIntMs(env, "CACHE_TTL_MS"),
    mongoSubscribersUri: requireString(env, "MONGODB_SUBSCRIBERS_URI"),
    publicBaseUrl: requireString(env, "PUBLIC_BASE_URL"),
    emailProviderApiKey: requireString(env, "EMAIL_PROVIDER_API_KEY"),
    emailSenderAddress: requireString(env, "EMAIL_SENDER_ADDRESS"),
    emailWebhookSigningSecret: requireString(env, "EMAIL_WEBHOOK_SIGNING_SECRET"),
    emailSuppressionHashSecret: requireString(env, "EMAIL_SUPPRESSION_HASH_SECRET"),
    unsubscribeTokenSecret: requireString(env, "UNSUBSCRIBE_TOKEN_SECRET"),
    confirmationTokenTtlMs: requirePositiveIntMs(env, "CONFIRMATION_TOKEN_TTL_MS"),
    signupResendCooldownMs: requirePositiveIntMs(env, "SIGNUP_RESEND_COOLDOWN_MS"),
    signupRateLimitMaxPerIp: requirePositiveInt(env, "SIGNUP_RATE_LIMIT_MAX_PER_IP"),
    signupRateLimitWindowMs: requirePositiveIntMs(env, "SIGNUP_RATE_LIMIT_WINDOW_MS"),
  };
}
