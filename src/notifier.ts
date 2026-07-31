import type { Db } from "mongodb";
import { loadNotifierEnvConfig, type NotifierEnvConfig } from "./config/notifierEnv.js";
import { connect, getNewsPublishedAfter } from "./adapters/repository.js";
import { acquireLock, releaseLock, ensureLockIndexes } from "./adapters/lock.js";
import {
  ensureDeliveryIndexes,
  recordDelivery,
  getDeliveredNewsIds,
} from "./adapters/deliveryRepository.js";
import { createNodemailerEmailSender, type EmailSender } from "./adapters/emailSender.js";
import { getActiveSubscribers } from "./adapters/subscriberRepository.js";
import { isNewsEligible, selectPendingNews, selectForMessage } from "./core/digestEligibility.js";
import { buildDigestEmail, type DigestNewsItem } from "./core/digestEmail.js";
import { deriveUnsubscribeToken } from "./core/tokens.js";
import { isWithinSendWindow } from "./core/sendWindow.js";

const LOCK_ID = "notifier";

/** Resumen agregado de una corrida — nunca una dirección de correo (Artículo IV). */
export interface RunDigestSummary {
  subscribersProcessed: number;
  messagesSent: number;
  itemsDelivered: number;
  sendFailures: number;
  sendAmbiguous: number;
}

export interface RunDigestDeps {
  db: Db;
  emailSender: EmailSender;
  /** Instante de la corrida, explícito — nunca `new Date()` disperso (research.md §2). */
  now: Date;
  config: NotifierEnvConfig;
}

const CHANNEL = "email" as const;

/**
 * Corrida completa del envío periódico: por cada suscriptor activo, calcula lo pendiente y lo
 * envía. Parametrizada por `db`/`emailSender`/`now`/`config` explícitos — nunca lee
 * `process.env` ni llama `new Date()` internamente (research.md §2/§13 de
 * specs/004-send-email-news/), para que los tests la inspeccionen directamente sin esperar al
 * reloj real.
 *
 * Fuera de la ventana horaria permitida no hace nada (FR-005) — ni siquiera lee suscriptores o
 * noticias. Dentro de la ventana, el tope por mensaje (FR-009) limita cada envío a las
 * noticias más recientes; lo excluido por el tope sigue pendiente, no se registra como
 * entregado.
 */
export async function runDigestOnce(deps: RunDigestDeps): Promise<RunDigestSummary> {
  const { db, emailSender, now, config } = deps;

  const summary: RunDigestSummary = {
    subscribersProcessed: 0,
    messagesSent: 0,
    itemsDelivered: 0,
    sendFailures: 0,
    sendAmbiguous: 0,
  };

  if (!isWithinSendWindow(now, config.timeZone, config.sendWindowStartLocal, config.sendWindowEndLocal)) {
    return summary;
  }

  const subscribers = await getActiveSubscribers(db);
  if (subscribers.length === 0) {
    return summary;
  }

  const eligibleWindowStart = new Date(now.getTime() - config.maxPendingAgeMs);
  const candidateNews = await getNewsPublishedAfter(db, eligibleWindowStart);

  // Procesamiento secuencial, sin paralelismo ni colas (research.md §12 de
  // specs/004-send-email-news/): cada entrega se registra inmediatamente después de la
  // confirmación del canal, antes de pasar al siguiente suscriptor (FR-011/FR-014).
  for (const subscriber of subscribers) {
    summary.subscribersProcessed += 1;

    const eligible = candidateNews.filter((news) =>
      isNewsEligible(
        { newsId: news._id, publishedAt: news.publishedAt },
        subscriber.activatedAt,
        config.maxPendingAgeMs,
        now,
      ),
    );
    if (eligible.length === 0) continue;

    const deliveredNewsIds = await getDeliveredNewsIds(db, subscriber._id, CHANNEL);
    const pending = selectPendingNews(
      eligible.map((news) => ({ newsId: news._id, publishedAt: news.publishedAt })),
      deliveredNewsIds,
    );
    if (pending.length === 0) continue;

    // `pending` conserva el orden descendente por `publishedAt` de `candidateNews`
    // (getNewsPublishedAfter, T009) — el tope se aplica sobre esa misma ordenación (FR-009).
    const { included, truncated } = selectForMessage(pending, config.maxNewsPerMessage);

    const pendingNewsById = new Map(candidateNews.map((news) => [news._id, news]));
    const items: DigestNewsItem[] = included.map((p) => {
      const news = pendingNewsById.get(p.newsId)!;
      return { title: news.title, summary: news.summary, link: news.link };
    });

    const unsubscribeToken = deriveUnsubscribeToken(subscriber._id, config.unsubscribeTokenSecret);
    const message = buildDigestEmail({
      to: subscriber._id,
      items,
      unsubscribeUrl: `${config.publicBaseUrl}/subscribers/unsubscribe/${unsubscribeToken}`,
      truncated,
      publicNewsUrl: `${config.publicBaseUrl}/news`,
    });

    const result = await emailSender.send(message);
    if (result === "confirmed") {
      summary.messagesSent += 1;
      for (const p of included) {
        await recordDelivery(db, {
          subscriberId: subscriber._id,
          newsId: p.newsId,
          channel: CHANNEL,
          deliveredAt: now,
        });
        summary.itemsDelivered += 1;
      }
    } else if (result === "failed") {
      summary.sendFailures += 1;
    } else {
      summary.sendAmbiguous += 1;
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const config = loadNotifierEnvConfig();
  const repo = await connect(config.mongoNotifierUri);
  try {
    await ensureDeliveryIndexes(repo.db);
    await ensureLockIndexes(repo.db);

    const acquired = await acquireLock(repo.db, LOCK_ID);
    if (!acquired) {
      // Corrida omitida por exclusión mutua: no es un fallo (contracts/notifier-cli-contract.md).
      console.error("Ya hay un envío en curso; esta invocación se omite.");
      return;
    }
    try {
      const emailSender = createNodemailerEmailSender(
        config.smtpHost,
        config.smtpPort,
        config.smtpUser,
        config.smtpPass,
        config.emailSenderAddress,
      );
      const now = new Date();
      const summary = await runDigestOnce({ db: repo.db, emailSender, now, config });
      console.error(
        `Envío OK: subscribersProcessed=${summary.subscribersProcessed} messagesSent=${summary.messagesSent} ` +
          `itemsDelivered=${summary.itemsDelivered} sendFailures=${summary.sendFailures} sendAmbiguous=${summary.sendAmbiguous}`,
      );
    } finally {
      await releaseLock(repo.db, LOCK_ID);
    }
  } finally {
    await repo.close();
  }
}

// Solo arranca el proceso real cuando este módulo se ejecuta directamente (`node
// dist/src/notifier.js`), nunca cuando algo lo importa — los tests importan `runDigestOnce`
// de este mismo archivo y no deben disparar `main()` (que exige las variables de entorno del
// proceso real) solo por importarlo.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => {
      process.exitCode = 0;
    })
    .catch((error: unknown) => {
      console.error("El envío falló:", error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
