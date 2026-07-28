import { isValidIanaTimeZone } from "../core/localTime.js";

export interface EnvConfig {
  mongoUri: string;
  sourceFeedUrl: string;
  targetCategory: string;
  timeZone: string;
  /** Retención de noticias (ms), medida de forma rodante desde publishedAt. FR-008/FR-009. */
  newsRetentionMs: number;
  /** Retención corta de la copia cruda de diagnóstico (ms), independiente de la anterior. */
  rawSnapshotRetentionMs: number;
  /** Umbral (ms) de ausencia prolongada de la categoría objetivo antes de alarmar. FR-014. */
  categorySilenceThresholdMs: number;
}

type EnvLike = { [key: string]: string | undefined };

function requireString(env: EnvLike, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Falta la variable de entorno requerida: ${name}`);
  }
  return value;
}

function requirePositiveIntMs(env: EnvLike, name: string): number {
  const raw = requireString(env, name);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `La variable de entorno ${name} debe ser un número positivo de milisegundos, recibido: "${raw}"`,
    );
  }
  return value;
}

/** Carga y valida la configuración; lanza si falta o es inválida alguna variable requerida. */
export function loadEnvConfig(env: EnvLike = process.env as EnvLike): EnvConfig {
  const timeZone = requireString(env, "TIMEZONE");
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(
      `TIMEZONE debe ser un nombre de zona IANA válido (ej. "America/Argentina/Buenos_Aires"), recibido: "${timeZone}"`,
    );
  }
  return {
    mongoUri: requireString(env, "MONGODB_URI"),
    sourceFeedUrl: requireString(env, "SOURCE_FEED_URL"),
    targetCategory: requireString(env, "TARGET_CATEGORY"),
    timeZone,
    newsRetentionMs: requirePositiveIntMs(env, "NEWS_RETENTION_MS"),
    rawSnapshotRetentionMs: requirePositiveIntMs(env, "RAW_SNAPSHOT_RETENTION_MS"),
    categorySilenceThresholdMs: requirePositiveIntMs(env, "CATEGORY_SILENCE_THRESHOLD_MS"),
  };
}
