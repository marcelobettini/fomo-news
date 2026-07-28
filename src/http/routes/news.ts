import type { FastifyInstance } from "fastify";
import type { NewsCache } from "../cache.js";

export interface NewsRouteDeps {
  cache: NewsCache;
}

/** Serialización de respuesta vía JSON Schema nativo de Fastify (research.md §1, contracts/http-contract.md). */
const responseSchema = {
  200: {
    type: "object",
    properties: {
      date: { type: "string" },
      timezone: { type: "string" },
      count: { type: "integer" },
      news: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
            link: { type: "string" },
            publishedAt: { type: "string" },
          },
          required: ["title", "summary", "link", "publishedAt"],
        },
      },
    },
    required: ["date", "timezone", "count", "news"],
  },
  304: {},
  503: {
    type: "object",
    properties: {
      error: { type: "string" },
    },
    required: ["error"],
  },
} as const;

/**
 * `GET /news` (FR-001/FR-002/FR-003/FR-006 a FR-009): las noticias de la categoría
 * configurada publicadas durante el día local en curso, ordenadas de más reciente a más
 * antigua. Un día sin noticias todavía es `200` con `news: []`, nunca un error. Sirve desde
 * la caché en memoria (T017) en vez de consultar MongoDB en cada petición, y emite
 * validadores de caché HTTP para que los clientes eviten transferencias redundantes.
 */
export async function registerNewsRoute(app: FastifyInstance, deps: NewsRouteDeps): Promise<void> {
  app.get("/news", { schema: { response: responseSchema } }, async (request, reply) => {
    const now = new Date();
    let snapshot;
    try {
      snapshot = await deps.cache.getSnapshot(now);
    } catch {
      // FR-007: un fallo de acceso al almacenamiento NUNCA se reporta como un conjunto vacío
      // exitoso — debe ser explícito y distinguible (Artículo VII).
      return reply.code(503).send({ error: "storage_unavailable" });
    }

    reply.header("ETag", snapshot.etag);
    reply.header("Last-Modified", snapshot.refreshedAt.toUTCString());
    const maxAgeSeconds = Math.max(0, Math.floor(deps.cache.ttlMs / 1000));
    reply.header("Cache-Control", `public, max-age=${maxAgeSeconds}, must-revalidate`);

    const ifNoneMatch = request.headers["if-none-match"];
    if (ifNoneMatch === snapshot.etag) {
      return reply.code(304).send();
    }

    return reply.send({
      date: snapshot.localDayKey,
      timezone: snapshot.timeZone,
      count: snapshot.news.length,
      news: snapshot.news,
    });
  });
}
