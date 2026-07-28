import type { MappedNews } from "./mapEntry.js";

export type EntryDecision = "new" | "updated" | "unchanged";

export interface DedupDecision {
  entry: MappedNews;
  decision: EntryDecision;
}

/** Lo ya conocido, para comparar contenido y distinguir actualización real de no-op. */
export type KnownNews = Pick<MappedNews, "title" | "summary" | "category" | "updatedAt">;

/**
 * Decide, para cada entrada, si es nueva, una actualización de contenido, o una repetición
 * sin cambios — SIEMPRE contra el estado persistido completo (todas las entradas de la
 * ventana en cada corrida), NUNCA filtrando por una marca de agua temporal (Artículo I).
 */
export function decideDedup(
  entries: readonly MappedNews[],
  knownNews: ReadonlyMap<string, KnownNews>,
): DedupDecision[] {
  return entries.map((entry) => {
    const known = knownNews.get(entry.link);
    if (!known) {
      return { entry, decision: "new" };
    }
    const changed =
      known.title !== entry.title ||
      known.summary !== entry.summary ||
      known.category !== entry.category ||
      known.updatedAt.getTime() !== entry.updatedAt.getTime();
    return { entry, decision: changed ? "updated" : "unchanged" };
  });
}
