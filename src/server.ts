import { loadServerEnvConfig } from "./config/serverEnv.js"
import { connectReadonly } from "./adapters/newsReader.js"
import { connect as connectSubscribers, ensureSubscriberIndexes } from "./adapters/subscriberRepository.js"
import { createResendEmailSender } from "./adapters/emailSender.js"
import { buildApp } from "./http/app.js"

async function main(): Promise<void> {
  const config = loadServerEnvConfig()
  const reader = await connectReadonly(config.mongoReadonlyUri)
  const subscribers = await connectSubscribers(config.mongoSubscribersUri)
  await ensureSubscriberIndexes(subscribers.db)
  const emailSender = createResendEmailSender(config.emailProviderApiKey, config.emailSenderAddress)

  const app = await buildApp({
    rateLimitMaxPerIp: config.rateLimitMaxPerIp,
    rateLimitWindowMs: config.rateLimitWindowMs,
    db: reader.db,
    timeZone: config.timeZone,
    cacheTtlMs: config.cacheTtlMs,
    subscribersDb: subscribers.db,
    emailSender,
    publicBaseUrl: config.publicBaseUrl,
    confirmationTokenTtlMs: config.confirmationTokenTtlMs,
    signupResendCooldownMs: config.signupResendCooldownMs,
    signupRateLimitMaxPerIp: config.signupRateLimitMaxPerIp,
    signupRateLimitWindowMs: config.signupRateLimitWindowMs,
    emailWebhookSigningSecret: config.emailWebhookSigningSecret,
    emailSuppressionHashSecret: config.emailSuppressionHashSecret,
    unsubscribeTokenSecret: config.unsubscribeTokenSecret,
  })

  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    await app.close()
    await reader.close()
    await subscribers.close()
    process.exit(0)
  }
  process.on("SIGTERM", () => void shutdown())
  process.on("SIGINT", () => void shutdown())

  await app.listen({ port: config.port, host: "0.0.0.0" })
}

main()
  .then(() => console.log(`Server up http://localhost:${loadServerEnvConfig().port}`))
  .catch((error: unknown) => {
    console.error(
      "El servidor no pudo arrancar:",
      error instanceof Error ? error.message : error,
    )
    process.exitCode = 1
  })
