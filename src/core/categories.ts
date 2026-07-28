/** Categorías vistas en esta corrida que nunca se habían visto antes (FR-012/FR-015). */
export function detectNewCategories(
  seenThisRun: readonly string[],
  knownCategories: ReadonlySet<string>,
): string[] {
  const unique = new Set(seenThisRun.filter((category) => category.length > 0));
  return [...unique].filter((category) => !knownCategories.has(category));
}
