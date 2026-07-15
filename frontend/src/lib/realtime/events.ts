export type RealtimeEventType =
  | 'notification.created'
  | 'score.revision.created'
  | 'score.derived_asset.updated'
  | 'score.metadata.updated'
  | 'import_job.completed'
  | 'import_job.failed';

export const REALTIME_EVENT_SCHEMA_VERSION = 1;

export interface RealtimeEventEnvelope<TPayload = Record<string, unknown>> {
  schema_version: typeof REALTIME_EVENT_SCHEMA_VERSION;
  event_id: string;
  sequence: number;
  type: RealtimeEventType;
  score_id: string | null;
  revision_id: string | null;
  payload: TPayload;
  created_at: string;
}

export function parseRealtimeEvent(data: string): RealtimeEventEnvelope | null {
  try {
    const parsed = JSON.parse(data) as Partial<RealtimeEventEnvelope>;
    if (
      parsed.schema_version !== REALTIME_EVENT_SCHEMA_VERSION ||
      typeof parsed.event_id !== 'string' ||
      typeof parsed.sequence !== 'number' ||
      typeof parsed.type !== 'string'
    ) {
      return null;
    }
    return {
      schema_version: REALTIME_EVENT_SCHEMA_VERSION,
      event_id: parsed.event_id,
      sequence: parsed.sequence,
      type: parsed.type as RealtimeEventType,
      score_id: parsed.score_id ?? null,
      revision_id: parsed.revision_id ?? null,
      payload: typeof parsed.payload === 'object' && parsed.payload !== null ? parsed.payload : {},
      created_at: typeof parsed.created_at === 'string' ? parsed.created_at : '',
    };
  } catch {
    return null;
  }
}
