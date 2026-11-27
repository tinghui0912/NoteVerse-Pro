import { realtimeEventsUrl } from '@/lib/api/native-resource-urls';

export function createRealtimeEventSource(): EventSource {
  return new EventSource(realtimeEventsUrl(), {
    withCredentials: true,
  });
}
