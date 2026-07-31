import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { isValidEmailFormat } from "../../core/emailFormat.js";
import { generateToken, hashToken, deriveUnsubscribeToken } from "../../core/tokens.js";
import { isConfirmationTokenExpired, isResendCooldownElapsed } from "../../core/subscriberLifecycle.js";
import { buildConfirmationEmail } from "../../core/confirmationEmail.js";
import type { EmailSender } from "../../adapters/emailSender.js";
import {
  findByEmail,
  findByConfirmationTokenHash,
  findByUnsubscribeTokenHash,
  createPending,
  reissueConfirmationToken,
  activate,
  deleteAndSuppress,
} from "../../adapters/subscriberRepository.js";

export interface SubscribersRouteDeps {
  db: Db;
  emailSender: EmailSender;
  publicBaseUrl: string;
  confirmationTokenTtlMs: number;
  signupResendCooldownMs: number;
  signupRateLimitMaxPerIp: number;
  signupRateLimitWindowMs: number;
  emailSuppressionHashSecret: string;
  unsubscribeTokenSecret: string;
}

function confirmationUrlFor(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl}/subscribers/confirm/${token}`;
}

function unsubscribeUrlFor(publicBaseUrl: string, token: string): string {
  return `${publicBaseUrl}/subscribers/unsubscribe/${token}`;
}

/**
 * `POST /subscribers`, `GET /subscribers/confirm/:token`, `GET`/`POST
 * /subscribers/unsubscribe/:token` (contracts/subscriber-http-contract.md). Viven en el mismo
 * archivo porque comparten el mismo modelo de datos (`subscriberRepository`) y porque US2/US4
 * extienden directamente lo que crea US1 (tasks.md).
 */
export async function registerSubscribersRoutes(
  app: FastifyInstance,
  deps: SubscribersRouteDeps,
): Promise<void> {
  app.post(
    "/subscribers",
    {
      config: {
        rateLimit: {
          max: deps.signupRateLimitMaxPerIp,
          timeWindow: deps.signupRateLimitWindowMs,
          keyGenerator: (request: { ip: string }) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as { email?: unknown } | undefined;
      const rawEmail = typeof body?.email === "string" ? body.email : "";
      const email = rawEmail.trim().toLowerCase();

      // FR-019: formato inválido se rechaza antes de considerar si existe un suscriptor —
      // no filtra información sobre ninguna dirección real.
      if (!isValidEmailFormat(email)) {
        return reply.code(400).send({ error: "invalid_email" });
      }

      const now = new Date();
      const existing = await findByEmail(deps.db, email);

      // FR-002/FR-015: alta nueva, o reenvío tras cooldown vencido de una pendiente; una
      // dirección ya activa, o pendiente dentro del cooldown, no produce ningún envío
      // (research.md §6) — pero la respuesta observable es siempre la misma (FR-017).
      const shouldSend =
        !existing || (existing.status === "pending" && isResendCooldownElapsed(existing.lastRequestAt, now, deps.signupResendCooldownMs));

      if (shouldSend) {
        const confirmationToken = generateToken();
        const unsubscribeToken = deriveUnsubscribeToken(email, deps.unsubscribeTokenSecret);
        const confirmationTokenExpiresAt = new Date(now.getTime() + deps.confirmationTokenTtlMs);

        if (!existing) {
          await createPending(deps.db, {
            email,
            confirmationTokenHash: hashToken(confirmationToken),
            confirmationTokenExpiresAt,
            unsubscribeTokenHash: hashToken(unsubscribeToken),
            now,
          });
        } else {
          await reissueConfirmationToken(deps.db, {
            email,
            confirmationTokenHash: hashToken(confirmationToken),
            confirmationTokenExpiresAt,
            now,
          });
        }

        const result = await deps.emailSender.send(
          buildConfirmationEmail({
            to: email,
            confirmationUrl: confirmationUrlFor(deps.publicBaseUrl, confirmationToken),
            unsubscribeUrl: unsubscribeUrlFor(deps.publicBaseUrl, unsubscribeToken),
          }),
        );
        if (result !== "confirmed") {
          throw new Error("No se pudo enviar el correo de confirmación");
        }
      }

      // FR-017: cuerpo y código fijos, idénticos sin importar el estado interno.
      return reply.code(202).send({ status: "ok" });
    },
  );

  app.get<{ Params: { token: string } }>("/subscribers/confirm/:token", async (request, reply) => {
    const confirmationTokenHash = hashToken(request.params.token);
    const doc = await findByConfirmationTokenHash(deps.db, confirmationTokenHash);

    if (!doc) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (doc.status === "active") {
      // FR-004: enlace ya utilizado exitosamente.
      return reply.code(409).send({ error: "already_used" });
    }

    const now = new Date();
    if (doc.confirmationTokenExpiresAt && isConfirmationTokenExpired(doc.confirmationTokenExpiresAt, now)) {
      // FR-005: motivo distinguible de "ya usado".
      return reply.code(410).send({ error: "expired" });
    }

    await activate(deps.db, doc._id, now);
    return reply.code(200).send({ status: "active", activatedAt: now.toISOString() });
  });

  const unsubscribeHandler = async (
    request: { params: { token: string } },
    reply: { code: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    const unsubscribeTokenHash = hashToken(request.params.token);
    const doc = await findByUnsubscribeTokenHash(deps.db, unsubscribeTokenHash);

    if (doc) {
      await deleteAndSuppress(deps.db, {
        email: doc._id,
        reason: "unsubscribed",
        now: new Date(),
        hmacSecret: deps.emailSuppressionHashSecret,
      });
    }

    // FR-009/FR-010: idempotente, siempre 200, exista o no el documento — nunca revela si la
    // dirección estuvo alguna vez suscripta a partir de una segunda invocación.
    return reply.code(200).send({ status: "ok" });
  };

  app.get<{ Params: { token: string } }>("/subscribers/unsubscribe/:token", unsubscribeHandler);
  app.post<{ Params: { token: string } }>("/subscribers/unsubscribe/:token", unsubscribeHandler);
}
