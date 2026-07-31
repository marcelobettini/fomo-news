import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { ensureSubscriberIndexes } from "./adapters/subscriberRepository.js";
import { createConsoleEmailSender } from "./adapters/emailSender.js";
import { buildApp } from "./http/app.js";

/**
 * Servidor local para probar el ciclo de vida de suscriptores (feature 003) a mano con
 * Insomnia/curl, sin Resend ni Atlas: Mongo efímero en memoria (mismo mecanismo que los tests,
 * `mongodb-memory-server`) y un `EmailSender` que imprime el mensaje por consola en vez de
 * enviarlo. Nunca usar en producción — no valida env vars ni persiste datos entre corridas.
 */
async function main(): Promise<void> {
  const port = Number(process.env["PORT"] ?? 3000);
  const publicBaseUrl = `http://localhost:${port}`;

  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db("fomo-news-dev");
  await ensureSubscriberIndexes(db);

  const app = await buildApp({
    rateLimitMaxPerIp: 10_000,
    rateLimitWindowMs: 60_000,
    db,
    timeZone: "America/Argentina/Buenos_Aires",
    cacheTtlMs: 5_000,
    subscribersDb: db,
    emailSender: createConsoleEmailSender(),
    publicBaseUrl,
    confirmationTokenTtlMs: 24 * 60 * 60 * 1000,
    signupResendCooldownMs: 60_000,
    signupRateLimitMaxPerIp: 10_000,
    signupRateLimitWindowMs: 60_000,
    emailWebhookSigningSecret: "dev-webhook-signing-secret",
    emailSuppressionHashSecret: "dev-suppression-hash-secret",
    unsubscribeTokenSecret: "dev-unsubscribe-token-secret",
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
    await client.close();
    await mongod.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Dev server up ${publicBaseUrl} (Mongo en memoria, correo simulado por consola)`);
}

main().catch((error: unknown) => {
  console.error("El dev server no pudo arrancar:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
