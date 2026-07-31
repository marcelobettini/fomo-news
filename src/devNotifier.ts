import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { ensureDeliveryIndexes } from "./adapters/deliveryRepository.js";
import { ensureLockIndexes } from "./adapters/lock.js";
import { createConsoleEmailSender } from "./adapters/emailSender.js";
import { runDigestOnce, type RunDigestDeps } from "./notifier.js";
import type { NewsDocument } from "./adapters/repository.js";
import type { SubscriberDocument } from "./adapters/subscriberRepository.js";

/**
 * Corrida local del envío periódico para revisar a ojo el contenido de los mensajes, sin
 * Resend ni Atlas: Mongo efímero en memoria (mismo mecanismo que los tests) sembrado con
 * suscriptores de ejemplo con `activatedAt` distintos y algunas noticias, y un `EmailSender`
 * que imprime cada mensaje por consola. Nunca usar en producción — no valida env vars ni
 * persiste datos entre corridas.
 *
 * `NOTIFIER_DEV_NOW` (opcional, ISO 8601) fuerza el `now` de la corrida, para probar a mano la
 * ventana horaria o el vencimiento de pendientes sin esperar al reloj real.
 */
async function main(): Promise<void> {
  const now = process.env["NOTIFIER_DEV_NOW"] ? new Date(process.env["NOTIFIER_DEV_NOW"]) : new Date();

  const mongod = await MongoMemoryServer.create();
  const client = new MongoClient(mongod.getUri());
  await client.connect();
  const db = client.db("fomo-news-dev-notifier");
  await ensureDeliveryIndexes(db);
  await ensureLockIndexes(db);

  const oneDayMs = 24 * 60 * 60 * 1000;
  const subscribers: SubscriberDocument[] = [
    {
      _id: "reciente@ejemplo.com",
      status: "active",
      confirmationTokenHash: "dev-confirmation-hash-reciente",
      unsubscribeTokenHash: "dev-unsubscribe-hash-reciente",
      lastRequestAt: now,
      createdAt: new Date(now.getTime() - 2 * oneDayMs),
      activatedAt: new Date(now.getTime() - 2 * oneDayMs),
    },
    {
      _id: "antiguo@ejemplo.com",
      status: "active",
      confirmationTokenHash: "dev-confirmation-hash-antiguo",
      unsubscribeTokenHash: "dev-unsubscribe-hash-antiguo",
      lastRequestAt: now,
      createdAt: new Date(now.getTime() - 20 * oneDayMs),
      activatedAt: new Date(now.getTime() - 20 * oneDayMs),
    },
  ];
  await db.collection<SubscriberDocument>("subscribers").insertMany(subscribers);

  const news: NewsDocument[] = [
    {
      _id: "https://tandil.example/noticia-vieja",
      title: "Noticia de hace una semana",
      summary: "Resumen de ejemplo de una noticia publicada hace una semana.",
      link: "https://tandil.example/noticia-vieja",
      category: "Policiales",
      publishedAt: new Date(now.getTime() - 7 * oneDayMs),
      updatedAt: new Date(now.getTime() - 7 * oneDayMs),
      firstSeenAt: new Date(now.getTime() - 7 * oneDayMs),
      expiresAt: new Date(now.getTime() + 23 * oneDayMs),
    },
    {
      _id: "https://tandil.example/noticia-nueva",
      title: "Noticia de hoy",
      summary: "Resumen de ejemplo de una noticia recién publicada.",
      link: "https://tandil.example/noticia-nueva",
      category: "Policiales",
      publishedAt: now,
      updatedAt: now,
      firstSeenAt: now,
      expiresAt: new Date(now.getTime() + 30 * oneDayMs),
    },
  ];
  await db.collection<NewsDocument>("news").insertMany(news);

  const deps: RunDigestDeps = {
    db,
    emailSender: createConsoleEmailSender(),
    now,
    config: {
      mongoNotifierUri: "unused-in-dev",
      timeZone: "America/Argentina/Buenos_Aires",
      publicBaseUrl: "http://localhost:3000",
      smtpHost: "unused-in-dev",
      smtpPort: 587,
      smtpUser: "unused-in-dev",
      smtpPass: "unused-in-dev",
      emailSenderAddress: "noticias@tandil.example",
      unsubscribeTokenSecret: "dev-unsubscribe-token-secret",
      sendWindowStartLocal: "00:00",
      sendWindowEndLocal: "23:59",
      maxPendingAgeMs: 30 * oneDayMs,
      maxNewsPerMessage: 20,
      maxSendIntervalMs: 6 * 60 * 60 * 1000,
      newsRetentionMs: 60 * oneDayMs,
    },
  };

  console.log(`Corrida de desarrollo, now=${now.toISOString()}\n`);
  const summary = await runDigestOnce(deps);
  console.log(
    `Resumen: subscribersProcessed=${summary.subscribersProcessed} messagesSent=${summary.messagesSent} ` +
      `itemsDelivered=${summary.itemsDelivered} sendFailures=${summary.sendFailures} sendAmbiguous=${summary.sendAmbiguous}`,
  );

  await client.close();
  await mongod.stop();
}

main().catch((error: unknown) => {
  console.error("El dev notifier no pudo arrancar:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
