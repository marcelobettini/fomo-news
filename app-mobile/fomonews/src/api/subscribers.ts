const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type SubscribeResult =
  | { kind: 'accepted' }
  | { kind: 'invalid_email' }
  | { kind: 'error' };

export async function subscribe(email: string): Promise<SubscribeResult> {
  try {
    const response = await fetch(`${API_URL}/subscribers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (response.status === 202) {
      return { kind: 'accepted' };
    }

    if (response.status === 400) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      if (body?.error === 'invalid_email') {
        return { kind: 'invalid_email' };
      }
    }

    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}
