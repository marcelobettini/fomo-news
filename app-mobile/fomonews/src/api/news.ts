import type { NewsItem } from './types';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type NewsFetchResult =
  | { kind: 'ok'; news: NewsItem[]; etag: string | null }
  | { kind: 'not_modified' }
  | { kind: 'unavailable' }
  | { kind: 'network_error' };

export async function fetchNews(etag: string | null): Promise<NewsFetchResult> {
  try {
    const headers: Record<string, string> = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const response = await fetch(`${API_URL}/news`, { headers });

    if (response.status === 304) {
      return { kind: 'not_modified' };
    }
    if (response.status === 503) {
      return { kind: 'unavailable' };
    }
    if (!response.ok) {
      return { kind: 'network_error' };
    }

    const body = (await response.json()) as { news: NewsItem[] };
    return { kind: 'ok', news: body.news, etag: response.headers.get('ETag') };
  } catch {
    return { kind: 'network_error' };
  }
}
