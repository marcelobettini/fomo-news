/**
 * `true` si la hora local de `now` (según `timeZone`) cae dentro de `[startLocal, endLocal]`
 * (formato "HH:MM", 24 horas). Se asume `startLocal <= endLocal` — una ventana que no cruza la
 * medianoche (Assumptions de spec.md de specs/004-send-email-news/). Usa
 * `Intl.DateTimeFormat`, mismo mecanismo que `localTime.ts` de las features 1/2, sin librería
 * de fechas (research.md §5).
 */
export function isWithinSendWindow(
  now: Date,
  timeZone: string,
  startLocal: string,
  endLocal: string,
): boolean {
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  // "en-GB" con hour12:false da "HH:MM"; algunas implementaciones de ICU usan "24:00" para
  // medianoche exacta en vez de "00:00" — se normaliza para que la comparación de string
  // siempre sea sobre un valor "00"-"23".
  const normalized = localTime.startsWith("24:") ? `00:${localTime.slice(3)}` : localTime;
  return normalized >= startLocal && normalized <= endLocal;
}
