import { requiredEnv } from '@/lib/env';

const REALTIME_API_BASE_URL = requiredEnv('NEXT_PUBLIC_REALTIME_API_BASE_URL');

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

export function realtimeEventsUrl(): string {
  return `${normalizeBaseUrl(REALTIME_API_BASE_URL)}/realtime/events`;
}

export function createRealtimeEventSource(): EventSource {
  return new EventSource(realtimeEventsUrl(), {
    withCredentials: true,
  });
}
