import { REALTIME_EVENTS_URL } from '@/lib/app-protocol';

function realtimeEventsUrl(): string {
  return REALTIME_EVENTS_URL;
}

export function createRealtimeEventSource(): EventSource {
  return new EventSource(realtimeEventsUrl(), {
    withCredentials: true,
  });
}
