import { randomBytes, createHash, createHmac } from "node:crypto";

const TOKEN_BYTES = 32;

/** Origen de aleatoriedad criptográfica, codificado para viajar en una URL (FR-018). */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Resumen sha256 hexadecimal, persistido en vez del token en claro (FR-018, data-model.md). */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Token de baja determinístico: HMAC-SHA256(email, secret), codificado igual que
 * `generateToken()` (base64url). A diferencia del token de confirmación (aleatorio,
 * de un solo uso), este token debe poder recalcularse en cualquier momento por cualquier
 * proceso que conozca el correo y el secreto compartido — el resumen periódico de noticias
 * (feature 004) necesita reconstruir el enlace de baja mucho después de la alta, cuando el
 * valor en claro original ya no existe en ningún lado (specs/004-send-email-news/research.md
 * §8). Mismo criterio "no reversible pero recomputable" que `suppressions._id`.
 */
export function deriveUnsubscribeToken(email: string, secret: string): string {
  return createHmac("sha256", secret).update(email).digest("base64url");
}
