import { isValidIanaTimeZone } from "../core/localTime.js";
import { requireString, requirePositiveInt, requirePositiveIntMs, type EnvLike } from "./env.js";

/** Configuración del proceso HTTP de solo lectura (feature 002), independiente del ingestor. */
export interface ServerEnvConfig {
  mongoReadonlyUri: string;
  timeZone: string;
  port: number;
  rateLimitMaxPerIp: number;
  rateLimitWindowMs: number;
  /** TTL (ms) de la caché en memoria del conjunto del día (research.md §3). */
  cacheTtlMs: number;
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
  };
}
