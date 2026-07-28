/**
 * Comprueba que un nombre de zona sea un identificador IANA de región válido (Artículo VI).
 *
 * Intl.DateTimeFormat acepta por especificación identificadores de offset UTC fijo (ej.
 * "-03:00", "Etc/GMT+3") como `timeZone` sin lanzar — pero un offset fijo es exactamente lo
 * que el Artículo VI prohíbe ("los offsets cambian por decisión política y un valor fijo
 * desplaza todo el sistema en silencio"). Por eso se exige además el formato "Área/Ciudad" de
 * la base de datos IANA y se rechazan explícitamente las zonas "Etc/*", que son offsets fijos
 * disfrazados de zona.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone.includes("/") || timeZone.startsWith("Etc/")) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Devuelve el día local (YYYY-MM-DD) correspondiente a un instante UTC, según la zona horaria
 * IANA configurada. El instante se almacena siempre en UTC; esta es la única conversión a día
 * local que debe usarse para decisiones de negocio (Artículo VI).
 */
export function toLocalDateKey(instant: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(instant);
}

export interface LocalDayRange {
  /** Instante UTC correspondiente al inicio (00:00:00) del día local vigente. */
  startUtc: Date;
  /** El instante de la consulta; el corte de "día en curso" nunca es un límite fijo. */
  endUtc: Date;
}

/**
 * Calcula el rango UTC del día calendario local vigente en `now`, según `timeZone` (Artículo
 * VI: la decisión de "a qué día pertenece" se resuelve en hora local, nunca comparando
 * instantes UTC directamente). Usado para filtrar noticias del "día en curso" sin depender de
 * una biblioteca de fechas (feature 002, research.md §5).
 */
export function localDayRangeUtc(now: Date, timeZone: string): LocalDayRange {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // Hora local vigente expresada como si fuera UTC (mismos números de reloj), para poder
  // calcular el offset actual de la zona respecto de UTC sin una librería de fechas.
  const localAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = localAsUtc - now.getTime();

  // Medianoche local expresada con los mismos números de reloj, luego corregida por el
  // offset para obtener el instante UTC real de inicio del día local.
  const startOfLocalDayAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), 0, 0, 0);
  const startUtc = new Date(startOfLocalDayAsUtc - offsetMs);

  return { startUtc, endUtc: now };
}
