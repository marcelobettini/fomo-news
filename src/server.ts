import { loadServerEnvConfig } from "./config/serverEnv.js";
import { connectReadonly } from "./adapters/newsReader.js";
import { buildApp } from "./http/app.js";

async function main(): Promise<void> {
  const config = loadServerEnvConfig();
  const reader = await connectReadonly(config.mongoReadonlyUri);

  const app = await buildApp({
    rateLimitMaxPerIp: config.rateLimitMaxPerIp,
    rateLimitWindowMs: config.rateLimitWindowMs,
    db: reader.db,
    timeZone: config.timeZone,
    cacheTtlMs: config.cacheTtlMs,
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
    await reader.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((error: unknown) => {
  console.error(
    "El servidor no pudo arrancar:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
