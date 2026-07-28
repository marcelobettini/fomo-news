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
