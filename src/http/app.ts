import type { Db } from "mongodb";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { registerNewsRoute } from "./routes/news.js";
import { createNewsCache } from "./cache.js";

export interface AppConfig {
  rateLimitMaxPerIp: number;
  rateLimitWindowMs: number;
  /** Conexión de solo lectura ya abierta (T007); la ruta `/news` la usa a través de la caché. */
  db: Db;
  timeZone: string;
  /** TTL (ms) de la caché en memoria del conjunto del día (research.md §3). */
  cacheTtlMs: number;
}

/**
 * Construye la instancia Fastify del endpoint público (feature 002). Registra los plugins de
 * primera parte de CORS y límite de tasa; la ruta `GET /news` se registra por separado (ver
 * `src/http/routes/news.ts`) para que Foundational quede testeable antes de que exista la
 * lógica de negocio de ninguna historia de usuario. Exportada para que los tests la ejerciten
 * con `.inject()`, sin abrir un puerto real (research.md §1).
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify();

  // FR-014: cualquier origen, sin restricción de dominio — decisión fija, no configurable
  // (research.md §8).
  await app.register(cors, { origin: true });

  // FR-010: límite de tasa por IP (research.md §7); el umbral es configuración, no una
  // constante embebida.
  await app.register(rateLimit, {
    max: config.rateLimitMaxPerIp,
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => request.ip,
  });

  const cache = createNewsCache({ db: config.db, timeZone: config.timeZone, ttlMs: config.cacheTtlMs });
  await registerNewsRoute(app, { cache });

  return app;
}
