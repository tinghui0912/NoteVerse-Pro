import { localMediaAssetFixture } from '@/lib/practice/__fixtures__/local-media-asset';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createPerformanceRecording, type PerformanceRecording } from './recording-artifact';

const ready = () => ({
  status: 'READY' as const, kind: 'AUDIO' as const, media: localMediaAssetFixture(new Blob(['audio'])), mimeType: 'audio/webm',
  timebase: { activeSegments: [{ performanceStartUs: 0, performanceEndUs: 100000, mediaStartUs: 0, mediaEndUs: 100000 }], nominalMediaDurationUs: 100000 }
});
describe('independent optional recording artifact', () => {
  it('only READY has a timebase and media payload', () => {
    expectTypeOf<keyof Extract<PerformanceRecording, { status: 'NOT_RECORDED' }>>().toEqualTypeOf<'status'>();
    expectTypeOf<keyof Extract<PerformanceRecording, { status: 'UNAVAILABLE' }>>().toEqualTypeOf<'status' | 'reason'>();
    expect(createPerformanceRecording({ status: 'NOT_RECORDED' })).toEqual({ status: 'NOT_RECORDED' });
    expect(createPerformanceRecording({ status: 'UNAVAILABLE', reason: 'NotAllowedError' })).toEqual({ status: 'UNAVAILABLE', reason: 'NotAllowedError' });
    const value = ready();
    expect(createPerformanceRecording(value)).toEqual(value);
    expect(Object.keys(createPerformanceRecording(value)).sort()).toEqual(['kind', 'media', 'mimeType', 'status', 'timebase']);
  });
  it.each([
    { ...ready(), timebase: { activeSegments: [], nominalMediaDurationUs: 10000 } },
    { ...ready(), media: localMediaAssetFixture(new Blob([])) }, { ...ready(), mimeType: '' },
    { ...ready(), mimeType: 'audio/unknown' }, { ...ready(), mimeType: 'video/mp4' },
    { status: 'NOT_RECORDED', timebase: ready().timebase },
    { status: 'UNAVAILABLE', reason: 'failed', timebase: ready().timebase },
    { ...ready(), scoreId: 'duplicate-result-identity' },
  ])('rejects malformed or unrelated media fields %#', value => {
    expect(() => createPerformanceRecording(value as PerformanceRecording)).toThrow();
  });
});
