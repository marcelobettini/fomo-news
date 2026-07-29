/** Vencimiento de tokens de confirmación (FR-005, research.md §5): comparación explícita de instantes. */
export function isConfirmationTokenExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/** Cooldown de reenvío por dirección de destino (FR-015/FR-016, research.md §6). */
export function isResendCooldownElapsed(lastRequestAt: Date, now: Date, cooldownMs: number): boolean {
  return now.getTime() - lastRequestAt.getTime() >= cooldownMs;
}

export type ChannelSignal = "permanent" | "transient" | "complaint" | "ignored";

/**
 * Traduce el vocabulario del proveedor (Resend, esquema de eventos tipo Svix) a las tres
 * categorías de negocio de FR-012/FR-013/FR-014, aislando el nombre exacto de los campos del
 * proveedor a este único punto del código (data-model.md).
 */
export function classifyChannelSignal(eventType: string, bounceSubtype?: string): ChannelSignal {
  if (eventType === "email.complained") return "complaint";
  if (eventType === "email.bounced") {
    if (bounceSubtype === "Permanent") return "permanent";
    if (bounceSubtype === "Transient") return "transient";
    return "ignored";
  }
  return "ignored";
}
