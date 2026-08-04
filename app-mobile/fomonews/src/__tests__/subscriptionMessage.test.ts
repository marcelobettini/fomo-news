import { mapSubscribeResultToMessage, SUBSCRIPTION_MESSAGES } from '../validation/subscriptionMessage';
import type { SubscribeResult } from '../api/subscribers';

describe('mapSubscribeResultToMessage', () => {
  it('maps accepted (202) to the success message', () => {
    const result: SubscribeResult = { kind: 'accepted' };
    expect(mapSubscribeResultToMessage(result)).toBe(SUBSCRIPTION_MESSAGES.success);
  });

  it('maps invalid_email (400) to the invalid format message', () => {
    const result: SubscribeResult = { kind: 'invalid_email' };
    expect(mapSubscribeResultToMessage(result)).toBe(SUBSCRIPTION_MESSAGES.invalidFormat);
  });

  it('maps any other failure (429/5xx/timeout/no network) to the generic error message', () => {
    const result: SubscribeResult = { kind: 'error' };
    expect(mapSubscribeResultToMessage(result)).toBe(SUBSCRIPTION_MESSAGES.genericError);
  });
});
