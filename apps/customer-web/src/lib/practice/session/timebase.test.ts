import { PracticeTimebase, type SessionTime } from '@/lib/practice/session/timebase';
import { describe, expect, it } from 'vitest';
function sessionTime(domainId: string, ms: number, sampleIndex?: number): SessionTime {
  return sampleIndex === undefined ? { domainId, ms } : { domainId, ms, sampleIndex };
}
describe('Practice session timebase', () => {
  it('defines one comparable local session timebase for runtime and sample-index evidence', () => {
    const timebase = new PracticeTimebase({
      domainId: 'session-domain',
      runtimeOriginMs: 1_000,
      sampleRateHz: 16_000,
      anchorSampleIndex: 8_000,
      anchorSessionTimeMs: 250,
    });

    expect(timebase.runtimeToSessionTime(1_250)).toEqual({ domainId: 'session-domain', ms: 250 });
    expect(timebase.sampleIndexToSessionTime(8_000)).toEqual({
      domainId: 'session-domain',
      ms: 250,
      sampleIndex: 8_000,
    });
    expect(timebase.sampleIndexToSessionTime(9_600)).toEqual({
      domainId: 'session-domain',
      ms: 350,
      sampleIndex: 9_600,
    });
    expect(timebase.sampleIndexToSessionTime(6_400)).toEqual({
      domainId: 'session-domain',
      ms: 150,
      sampleIndex: 6_400,
    });
    expect(() => timebase.assertSameSessionTimeDomain(
      timebase.runtimeToSessionTime(1_250),
      timebase.sampleIndexToSessionTime(8_000)
    )).not.toThrow();
    expect(() => timebase.assertSameSessionTimeDomain(
      timebase.runtimeToSessionTime(1_250),
      sessionTime('other-domain', 250)
    )).toThrow(/different practice time domains/);
  });

  it("maps acoustic sample anchors into session time", () => {

    const acousticTimebase = new PracticeTimebase({
      domainId: 'normalized-acoustic',
      sampleRateHz: 16_000,
      anchorSampleIndex: 16_000,
      anchorSessionTimeMs: 500,
    });
    expect(acousticTimebase.sampleIndexToSessionTime(16_800).ms).toBe(550);


  });
});
