import type { Db } from "mongodb";
import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { registerNewsRoute } from "./routes/news.js";
import { registerSubscribersRoutes } from "./routes/subscribers.js";
import { registerEmailWebhookRoute } from "./routes/emailWebhooks.js";
import { createNewsCache } from "./cache.js";
import type { EmailSender } from "../adapters/emailSender.js";

declare module "fastify" {
  interface FastifyRequest {
    /**
     * Cuerpo JSON exacto, sin re-serializar, capturado antes de parsear (necesario para
     * verificar la firma HMAC de `POST /webhooks/email` contra el cuerpo crudo, research.md
     * §3 — re-serializar el JSON parseado podría no coincidir byte a byte con lo firmado).
     */
    rawBody?: string;
  }
}

export interface AppConfig {
  rateLimitMaxPerIp: number;
  rateLimitWindowMs: number;
  /** Conexión de solo lectura ya abierta (T007); la ruta `/news` la usa a través de la caché. */
  db: Db;
  timeZone: string;
  /** TTL (ms) de la caché en memoria del conjunto del día (research.md §3). */
  cacheTtlMs: number;
  /** Conexión de lectura-escritura acotada a `subscribers`/`suppressions` (feature 003, research.md §4). */
  subscribersDb: Db;
  /** Adaptador de envío de correo, sustituible en pruebas (research.md §11). */
  emailSender: EmailSender;
  publicBaseUrl: string;
  confirmationTokenTtlMs: number;
  signupResendCooldownMs: number;
  signupRateLimitMaxPerIp: number;
  signupRateLimitWindowMs: number;
  emailWebhookSigningSecret: string;
  emailSuppressionHashSecret: string;
  /** Secreto compartido con el notifier para derivar el token de baja (research.md §8 de specs/004-send-email-news/). */
  unsubscribeTokenSecret: string;
}

/**
 * Construye la instancia Fastify del proceso HTTP (feature 002 `GET /news` + feature 003 ciclo
 * de vida de suscriptores). Registra los plugins de primera parte de CORS y límite de tasa; las
 * rutas se registran por separado (`src/http/routes/`) para que cada historia de usuario quede
 * testeable de forma independiente. Exportada para que los tests la ejerciten con `.inject()`,
 * sin abrir un puerto real (research.md §1).
 */
export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify();

  // FR-020: ningún mensaje de error de las rutas de suscriptores debe incluir la dirección de
  // correo en texto — respuesta genérica y sin exponer el detalle interno del error (p. ej. un
  // mensaje de MongoDB que incluya el `_id` en un error de clave duplicada). Los errores ya
  // codificados por otro plugin (p. ej. 429 de @fastify/rate-limit) conservan su status code;
  // solo se generaliza un fallo interno no anticipado (5xx).
  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: { name: error.name, message: "internal_error" } }, "unhandled_error");
    const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    const responseBody = statusCode < 500 ? { error: error.message } : { error: "internal_error" };
    reply.code(statusCode).send(responseBody);
  });

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

  // Content-type parser propio para JSON que además conserva el cuerpo crudo sin parsear
  // (research.md §3): necesario únicamente para verificar la firma de `POST /webhooks/email`;
  // las demás rutas JSON (`POST /subscribers`) usan `request.body` como siempre.
  app.addContentTypeParser<string>("application/json", { parseAs: "string" }, (request, body, done) => {
    request.rawBody = body;
    if (body.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // Baja de un clic (RFC 8058, research.md §8): el cliente de correo envía
  // `Content-Type: application/x-www-form-urlencoded`, cuyo cuerpo no se necesita para decidir
  // nada (el token ya está en la ruta) — se registra un parser trivial que solo drena el
  // cuerpo, sin sumar `@fastify/formbody`.
  app.addContentTypeParser<string>(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, _body, done) => {
      done(null, undefined);
    },
  );

  const cache = createNewsCache({ db: config.db, timeZone: config.timeZone, ttlMs: config.cacheTtlMs });
  await registerNewsRoute(app, { cache });

  await registerSubscribersRoutes(app, {
    db: config.subscribersDb,
    newsDb: config.db,
    timeZone: config.timeZone,
    emailSender: config.emailSender,
    publicBaseUrl: config.publicBaseUrl,
    confirmationTokenTtlMs: config.confirmationTokenTtlMs,
    signupResendCooldownMs: config.signupResendCooldownMs,
    signupRateLimitMaxPerIp: config.signupRateLimitMaxPerIp,
    signupRateLimitWindowMs: config.signupRateLimitWindowMs,
    emailSuppressionHashSecret: config.emailSuppressionHashSecret,
    unsubscribeTokenSecret: config.unsubscribeTokenSecret,
  });

  await registerEmailWebhookRoute(app, {
    db: config.subscribersDb,
    emailWebhookSigningSecret: config.emailWebhookSigningSecret,
    emailSuppressionHashSecret: config.emailSuppressionHashSecret,
  });

  return app;
}
