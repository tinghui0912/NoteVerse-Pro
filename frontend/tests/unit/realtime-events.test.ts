import { describe, expect, it } from 'vitest';

import {
  parseRealtimeEvent,
  REALTIME_EVENT_SCHEMA_VERSION,
} from '@/lib/realtime/events';

describe('realtime event parsing', () => {
  it('accepts the current versioned event envelope', () => {
    const event = parseRealtimeEvent(JSON.stringify({
      schema_version: REALTIME_EVENT_SCHEMA_VERSION,
      event_id: 'event-1',
      sequence: 10,
      type: 'score.derived_asset.updated',
      resource_type: 'score',
      resource_id: 'score-1',
      score_id: 'score-1',
      revision_id: 'revision-1',
      payload: { asset: 'preview', status: 'ready' },
      created_at: '2026-07-12T00:00:00Z',
    }));

    expect(event).toMatchObject({
      schema_version: REALTIME_EVENT_SCHEMA_VERSION,
      event_id: 'event-1',
      sequence: 10,
      type: 'score.derived_asset.updated',
      score_id: 'score-1',
      revision_id: 'revision-1',
      payload: { asset: 'preview', status: 'ready' },
    });
  });

  it('rejects unknown or missing schema versions', () => {
    expect(parseRealtimeEvent(JSON.stringify({
      event_id: 'event-1',
      sequence: 10,
      type: 'notification.created',
    }))).toBeNull();

    expect(parseRealtimeEvent(JSON.stringify({
      schema_version: 999,
      event_id: 'event-1',
      sequence: 10,
      type: 'notification.created',
    }))).toBeNull();
  });
});
