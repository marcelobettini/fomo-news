export type AlarmCode = "full-window-rotation" | "category-silence";

export interface AlarmInput {
  entriesSeen: number;
  entriesNew: number;
  /** Si existe al menos una corrida previa con status "success" (excepción de FR-013). */
  hasPriorSuccessfulRun: boolean;
  now: Date;
  /** Última vez que se vio (nueva o no) una entrada de la categoría objetivo; null si nunca. */
  lastTargetCategoryObservedAt: Date | null;
  categorySilenceThresholdMs: number;
}

/**
 * Evalúa las alarmas de pérdida de datos del Artículo VII. FR-013 y FR-022 son la misma
 * condición ("100% de lo visto es nuevo") vista desde dos ángulos (ver spec.md); por eso
 * comparten un único código `full-window-rotation`.
 */
export function evaluateAlarms(input: AlarmInput): AlarmCode[] {
  const alarms: AlarmCode[] = [];

  const fullRotation =
    input.hasPriorSuccessfulRun && input.entriesSeen > 0 && input.entriesNew === input.entriesSeen;
  if (fullRotation) {
    alarms.push("full-window-rotation");
  }

  const elapsedSinceLastSeen = input.lastTargetCategoryObservedAt
    ? input.now.getTime() - input.lastTargetCategoryObservedAt.getTime()
    : Number.POSITIVE_INFINITY;
  if (elapsedSinceLastSeen > input.categorySilenceThresholdMs) {
    alarms.push("category-silence");
  }

  return alarms;
}

/**
 * FR-017/Artículo VII: una corrida que no ve ninguna entrada (entriesSeen === 0) o que falló
 * al obtener/parsear la fuente NUNCA se registra como exitosa, aunque entriesNew también sea
 * 0 en una corrida normal con entriesSeen > 0 (eso sí es éxito: nada nuevo que capturar).
 */
export function determineRunStatus(entriesSeen: number, hadFetchError: boolean): "success" | "failure" {
  if (hadFetchError) return "failure";
  if (entriesSeen === 0) return "failure";
  return "success";
}
