import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import { getTodayNews } from "../adapters/newsReader.js";
import { toLocalDateKey } from "../core/localTime.js";
import type { PublicNews } from "../core/publicNews.js";

export interface CacheSnapshot {
  news: PublicNews[];
  localDayKey: string;
  timeZone: string;
  etag: string;
  refreshedAt: Date;
}

export interface NewsCacheDeps {
  db: Db;
  timeZone: string;
  ttlMs: number;
}

export interface NewsCache {
  readonly ttlMs: number;
  getSnapshot(now: Date): Promise<CacheSnapshot>;
}

function computeEtag(news: readonly PublicNews[]): string {
  return createHash("sha1").update(JSON.stringify(news)).digest("hex");
}

function isStale(
  snapshot: CacheSnapshot | null,
  now: Date,
  localDayKey: string,
  ttlMs: number,
): boolean {
  if (!snapshot) return true;
  if (snapshot.localDayKey !== localDayKey) return true;
  return now.getTime() - snapshot.refreshedAt.getTime() >= ttlMs;
}

/**
 * Caché en memoria del conjunto del día (research.md §3, FR-008/FR-009): evita consultar
 * MongoDB en cada petición mientras el TTL configurado no venció y el día local vigente no
 * cambió. Un cambio de día local invalida el snapshot sin esperar el TTL. Estilo funcional
 * (sin clases), consistente con el resto del repositorio.
 */
export function createNewsCache(deps: NewsCacheDeps): NewsCache {
  let snapshot: CacheSnapshot | null = null;

  return {
    ttlMs: deps.ttlMs,
    async getSnapshot(now: Date): Promise<CacheSnapshot> {
      const localDayKey = toLocalDateKey(now, deps.timeZone);
      if (isStale(snapshot, now, localDayKey, deps.ttlMs)) {
        const news = await getTodayNews(deps.db, now, deps.timeZone);
        snapshot = {
          news,
          localDayKey,
          timeZone: deps.timeZone,
          etag: computeEtag(news),
          refreshedAt: now,
        };
      }
      // `isStale` devuelve `true` cada vez que `snapshot` es `null`, así que en ese caso
      // siempre se reasigna arriba antes de este punto.
      return snapshot!;
    },
  };
}
