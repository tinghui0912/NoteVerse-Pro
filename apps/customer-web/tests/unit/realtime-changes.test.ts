import { describe, expect, it } from 'vitest';
import { parseRealtimeChange, parseRealtimeCheckpoint, parseRealtimeResyncRequired } from '@/lib/realtime/generated/events';
const base = {
  schemaVersion: 1,
  sequence: 42,
  changeId: 'change',
  createdAt: '2026-07-01T00:00:00Z',
};
describe('typed realtime changes', () => {
  it.each([
    { kind: 'notifications.changed', notificationId: null },
    {
      kind: 'score.revisions.changed',
      scoreId: 'score',
      revisionId: 'revision',
    },
    {
      kind: 'score.derived_assets.changed',
      scoreId: 'score',
      revisionId: 'revision',
    },
    {
      kind: 'score.metadata.changed',
      scoreId: 'score',
      revisionId: 'revision',
    },
    { kind: 'import_jobs.changed', importJobId: 'job' },
  ])('admits $kind', (identities) => {
    const change = { ...base, ...identities };
    expect(parseRealtimeChange(JSON.stringify(change))).toEqual(change);
  });
  it.each([
    { ...base, kind: 'unknown' },
    { ...base, kind: 'notifications.changed', notificationId: null, private: 'detail' },
    { ...base, kind: 'notifications.changed', notificationId: null, sequence: 0 },
    { ...base, kind: 'notifications.changed', notificationId: null, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, kind: 'notifications.changed', notificationId: null, createdAt: '2026-11-15T10:00:00' },
    { ...base, kind: 'notifications.changed', notificationId: null, createdAt: '2026-11-15 10:00:00Z' },
    { ...base, kind: 'notifications.changed', notificationId: null, createdAt: '2026-11-15T10:00:00+08:60' },
    { ...base, kind: 'notifications.changed', notificationId: null, createdAt: '2026-02-30T10:00:00Z' },
    { ...base, kind: 'notifications.changed', schemaVersion: 2 },
    { ...base, kind: 'score.metadata.changed', scoreId: 'score' },
    { ...base, kind: 'import_jobs.changed', importJobId: 2 },
    {
      ...base,
      kind: 'notifications.changed',
      notificationId: null,
      sequence: 1.5,
    },
    {
      ...base,
      kind: 'notifications.changed',
      notificationId: null,
      createdAt: 'invalid',
    },
  ])('rejects malformed changes', (change) =>
    expect(parseRealtimeChange(JSON.stringify(change))).toBeNull()
  );
  it('rejects malformed JSON', () => expect(parseRealtimeChange('{')).toBeNull());
  it.each([0, 42])('admits checkpoint cursor %s', (sequence) => {
    const checkpoint = { schemaVersion: 1, sequence };
    expect(parseRealtimeCheckpoint(JSON.stringify(checkpoint))).toEqual(checkpoint);
  });
  it.each(['retention_gap', 'cursor_out_of_range', 'invalid_cursor'])('admits resync reason %s', (reason) => {
    const control = { schemaVersion: 1, sequence: 0, reason };
    expect(parseRealtimeResyncRequired(JSON.stringify(control))).toEqual(control);
  });
  it.each([
    { schemaVersion: 1, sequence: -1 },
    { schemaVersion: true, sequence: 0 },
    { schemaVersion: 1, sequence: 0, private: 'detail' },
    { sequence: 0 },
  ])('rejects malformed checkpoints', (value) => {
    expect(parseRealtimeCheckpoint(JSON.stringify(value))).toBeNull();
  });
  it('rejects unknown resync reasons and extra fields', () => {
    expect(parseRealtimeResyncRequired(JSON.stringify({ schemaVersion: 1, sequence: 0, reason: 'unknown' }))).toBeNull();
    expect(parseRealtimeResyncRequired(JSON.stringify({ schemaVersion: 1, sequence: 0, reason: 'retention_gap', private: true }))).toBeNull();
  });
});
