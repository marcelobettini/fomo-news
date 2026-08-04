import type { SubscribeResult } from '../api/subscribers';

export const SUBSCRIPTION_MESSAGES = {
  invalidFormat: 'Ingresá un email con formato válido.',
  success: 'Revisá tu correo para confirmar la suscripción.',
  genericError: 'No se pudo completar, probá de nuevo.',
} as const;

export function mapSubscribeResultToMessage(result: SubscribeResult): string {
  switch (result.kind) {
    case 'accepted':
      return SUBSCRIPTION_MESSAGES.success;
    case 'invalid_email':
      return SUBSCRIPTION_MESSAGES.invalidFormat;
    case 'error':
      return SUBSCRIPTION_MESSAGES.genericError;
  }
}
