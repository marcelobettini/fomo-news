/**
 * Validación sintáctica de dirección de correo (FR-019), sin verificar existencia de dominio
 * (Assumptions de spec.md). Sin dependencia externa de validación.
 */
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailFormat(value: string): boolean {
  return EMAIL_FORMAT.test(value.trim());
}
