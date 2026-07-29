import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { classifyChannelSignal } from "../../core/subscriberLifecycle.js";
import { deleteAndSuppress } from "../../adapters/subscriberRepository.js";

export interface EmailWebhookRouteDeps {
  db: Db;
  emailWebhookSigningSecret: string;
  emailSuppressionHashSecret: string;
}

interface ResendBounceEvent {
  type?: string;
  data?: {
    bounce_type?: string;
    to?: string[];
  };
}

/** Compara una candidata `v1,<base64>` (o el valor crudo) contra la firma esperada, sin filtrar tiempo. */
function matchesSignature(expectedBase64: string, candidate: string): boolean {
  const sig = candidate.includes(",") ? candidate.split(",")[1] : candidate;
  if (!sig) return false;
  const expected = Buffer.from(expectedBase64, "base64");
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64");
  } catch {
    return false;
  }
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

/**
 * `POST /webhooks/email` (research.md §3, FR-012/FR-013/FR-014): verifica la firma HMAC-SHA256
 * (esquema Svix) sobre el cuerpo crudo antes de actuar; una firma inválida se rechaza con `401`
 * sin procesar el evento — ninguna suscripción se ve afectada por un webhook no verificado.
 */
export async function registerEmailWebhookRoute(
  app: FastifyInstance,
  deps: EmailWebhookRouteDeps,
): Promise<void> {
  app.post("/webhooks/email", async (request, reply) => {
    const svixId = request.headers["svix-id"];
    const svixTimestamp = request.headers["svix-timestamp"];
    const svixSignature = request.headers["svix-signature"];

    if (
      typeof svixId !== "string" ||
      typeof svixTimestamp !== "string" ||
      typeof svixSignature !== "string" ||
      request.rawBody === undefined
    ) {
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const signedContent = `${svixId}.${svixTimestamp}.${request.rawBody}`;
    const expectedSignature = createHmac("sha256", deps.emailWebhookSigningSecret)
      .update(signedContent)
      .digest("base64");

    const candidates = svixSignature.split(" ");
    const signatureValid = candidates.some((candidate) => matchesSignature(expectedSignature, candidate));

    if (!signatureValid) {
      // FR-012/FR-013/FR-014, research.md §3: firma inválida → nunca se procesa el cuerpo.
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const event = request.body as ResendBounceEvent | undefined;
    const eventType = typeof event?.type === "string" ? event.type : "";
    const bounceSubtype = event?.data?.bounce_type;
    const signal = classifyChannelSignal(eventType, bounceSubtype);

    if (signal === "permanent" || signal === "complaint") {
      const to = event?.data?.to?.[0];
      if (typeof to === "string" && to.length > 0) {
        await deleteAndSuppress(deps.db, {
          email: to.trim().toLowerCase(),
          reason: signal === "permanent" ? "hard_bounce" : "complaint",
          now: new Date(),
          hmacSecret: deps.emailSuppressionHashSecret,
        });
      }
    }
    // "transient"/"ignored" (FR-014): sin efecto sobre ninguna suscripción.

    return reply.code(200).send({ status: "ok" });
  });
}
