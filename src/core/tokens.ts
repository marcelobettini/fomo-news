import { randomBytes, createHash } from "node:crypto";

const TOKEN_BYTES = 32;

/** Origen de aleatoriedad criptográfica, codificado para viajar en una URL (FR-018). */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Resumen sha256 hexadecimal, persistido en vez del token en claro (FR-018, data-model.md). */
export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
