import { ownedMediaFixture } from '@/lib/practice/__fixtures__/recording-sink';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createPerformanceRecording, type PerformanceRecording } from './recording-artifact';

const ready = () => ({  status: 'READY' as const, kind: 'AUDIO' as const, media: ownedMediaFixture(new Blob(['audio'])), mimeType: 'audio/webm', durationMs: 100,
  timebase: { activeSegments: [{ perfStartMs: 0, perfEndMs: 100, mediaStartMs: 0, mediaEndMs: 100 }], nominalMediaDurationMs: 100 } });
describe('independent optional recording artifact', () => {
  it('only READY has a timebase and media payload', () => {
    expectTypeOf<keyof Extract<PerformanceRecording, { status: 'NOT_RECORDED' }>>().toEqualTypeOf<'status'>();
    expectTypeOf<keyof Extract<PerformanceRecording, { status: 'UNAVAILABLE' }>>().toEqualTypeOf<'status' | 'reason'>();
    expect(createPerformanceRecording({ status: 'NOT_RECORDED' })).toEqual({ status: 'NOT_RECORDED' });
    expect(createPerformanceRecording({ status: 'UNAVAILABLE', reason: 'NotAllowedError' })).toEqual({ status: 'UNAVAILABLE', reason: 'NotAllowedError' });
    const value = ready();
    expect(createPerformanceRecording(value)).toEqual(value);
    expect(Object.keys(createPerformanceRecording(value)).sort()).toEqual(['durationMs', 'kind', 'media', 'mimeType', 'status', 'timebase']);
  });
  it.each([
    { ...ready(), timebase: { activeSegments: [], nominalMediaDurationMs: 10 } },
    { ...ready(), media: ownedMediaFixture(new Blob([])) }, { ...ready(), mimeType: '' }, { ...ready(), durationMs: NaN },
    { ...ready(), mimeType: 'audio/unknown' }, { ...ready(), mimeType: 'video/mp4' },
    { status: 'NOT_RECORDED', timebase: ready().timebase },
    { status: 'UNAVAILABLE', reason: 'failed', timebase: ready().timebase },
    { ...ready(), scoreId: 'duplicate-result-identity' },
  ])('rejects malformed or unrelated media fields %#', value => {
    expect(() => createPerformanceRecording(value as PerformanceRecording)).toThrow();
  });
});
