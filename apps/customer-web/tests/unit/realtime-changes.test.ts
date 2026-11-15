import { describe, expect, it } from 'vitest';
import { parseRealtimeChange } from '@/lib/realtime/changes';
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
});
