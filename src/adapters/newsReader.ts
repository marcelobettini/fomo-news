import type { Db } from "mongodb";
import { connect, type RepositoryHandle, type NewsDocument } from "./repository.js";
import { localDayRangeUtc } from "../core/localTime.js";
import { toPublicNews, type PublicNews } from "../core/publicNews.js";

const NEWS_COLLECTION = "news";

/**
 * Conexión de solo lectura para el endpoint (feature 002, Artículo III). Reutiliza `connect()`
 * de `src/adapters/repository.ts` (genérico, no exclusivo de escritura) con la credencial
 * `MONGODB_READONLY_URI`, distinta de la `MONGODB_URI` de lectura-escritura del ingestor.
 */
export async function connectReadonly(mongoReadonlyUri: string): Promise<RepositoryHandle> {
  return connect(mongoReadonlyUri);
}

/**
 * Noticias del día calendario local vigente en `now`, ordenadas de más reciente a más
 * antigua. La colección `news` ya contiene únicamente la categoría objetivo (el ingestor solo
 * escribe entradas ya filtradas — feature 001), por lo que esta consulta no vuelve a filtrar
 * por categoría (data-model.md).
 */
export async function getTodayNews(
  db: Db,
  now: Date,
  timeZone: string,
): Promise<PublicNews[]> {
  const { startUtc, endUtc } = localDayRangeUtc(now, timeZone);
  const docs = await db
    .collection<NewsDocument>(NEWS_COLLECTION)
    .find({ publishedAt: { $gte: startUtc, $lt: endUtc } })
    .sort({ publishedAt: -1 })
    .toArray();
  return docs.map(toPublicNews);
}
