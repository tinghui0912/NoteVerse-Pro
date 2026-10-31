import { describe, expect, it } from 'vitest';
import cases from '../__fixtures__/meter-duration-cases.json';
import { measureDurationBeats, parsePracticeScoreArtifact, type PracticeScoreArtifact } from './artifact';
import canonical from '../__fixtures__/canonical-practice-score-artifact.json';
import { countInContractAt } from './count-in';
import { resolvePracticeScope } from './scope';
import { stepSessionPlan } from '../__fixtures__/session-plan';
import { StepPracticeRuntime } from '../step/domain/runtime';
import { ManualClock } from './timebase';

describe('canonical meter facts and execution policy', () => {
  it.each([
    { numerator: Number.MAX_SAFE_INTEGER, denominator: 4 },
    { numerator: Number.MAX_SAFE_INTEGER, denominator: Number.MAX_SAFE_INTEGER },
  ])('preserves portable integer boundary facts: $numerator/$denominator', (meter) => {
    const artifact = structuredClone(canonical) as PracticeScoreArtifact;
    artifact.meterSegments = [{ startBeat: 0, ...meter }];
    const before = structuredClone(artifact);
    expect(measureDurationBeats(meter)).toBeGreaterThan(0);
    expect(parsePracticeScoreArtifact(artifact)).toBe(artifact);
    expect(artifact).toEqual(before);
  });
  it.each(['numerator', 'denominator'] as const)('rejects a nonportable %s before duration projection', (field) => {
    const meter = { numerator: Number.MAX_SAFE_INTEGER, denominator: Number.MAX_SAFE_INTEGER };
    meter[field] = Number.MAX_SAFE_INTEGER + 1;
    // The ratio is an ordinary positive duration; exact integer transport owns admission.
    expect(meter.numerator * 4 / meter.denominator).toBeCloseTo(4);
    expect(() => measureDurationBeats(meter)).toThrow();
    const value = { ...structuredClone(canonical), meterSegments: [{ startBeat: 0, ...meter }] };
    const before = structuredClone(value);
    expect(() => parsePracticeScoreArtifact(value)).toThrow(expect.objectContaining({ code: 'practice_score_invalid' }));
    expect(value).toEqual(before);
  });
  it('requires meter integers to retain exact semantics across JSON and browser Number', () => {
    const decoded: { n: number } = JSON.parse('{"n":9007199254740993}');
    expect(String(decoded.n)).toBe('9007199254740992');
    expect(Number.isInteger(decoded.n)).toBe(true);
    expect(Number.isSafeInteger(decoded.n)).toBe(false);
    const value = { ...structuredClone(canonical), meterSegments: [{ startBeat: 0, numerator: decoded.n, denominator: 4 }] };
    expect(() => parsePracticeScoreArtifact(value)).toThrow(expect.objectContaining({ code: 'practice_score_invalid' }));
  });
  it.each(cases)('derives canonical duration from $numerator/$denominator', ({ numerator, denominator, durationBeats }) => {
    expect(measureDurationBeats({ numerator, denominator })).toBe(durationBeats);
  });
  it.each([[3, 4, 3, 3], [6, 8, 3, 6], [2, 2, 4, 2]])('plans %s/%s Count-In independently of serialized score facts', (numerator, denominator, durationBeats, pulses) => {
    const artifact = structuredClone(canonical) as PracticeScoreArtifact;
    artifact.meterSegments = [{ startBeat: 0, numerator, denominator }];
    expect(Object.keys(artifact.meterSegments[0]).sort()).toEqual(['denominator', 'numerator', 'startBeat']);
    expect(countInContractAt(artifact, 0)).toEqual({ numerator, denominator, durationBeats, pulses });
  });
  it.each([
    [], [{ startBeat: 1, numerator: 4, denominator: 4 }],
    [{ startBeat: 0, numerator: 4, denominator: 4 }, { startBeat: 0, numerator: 3, denominator: 4 }],
    [{ startBeat: -1, numerator: 4, denominator: 4 }],
    [{ startBeat: 0, numerator: true, denominator: 4 }],
    [{ startBeat: 0, numerator: 3.5, denominator: 4 }],
    [{ startBeat: 0, numerator: 4, denominator: 0 }],
    [{ startBeat: 0, numerator: 4, denominator: NaN }],
    [{ startBeat: 0, numerator: 4, denominator: '4' }],
    [{ startBeat: 0, numerator: 1e308, denominator: 1 }],
    [{ startBeat: 0, numerator: 1, denominator: 1e308 }],
    [{ startBeat: 0, numerator: 4 }],
    [{ startBeat: 0, numerator: 4, denominator: 4, unexpectedField: true }],
  ].map(meterSegments => ({ meterSegments })))('rejects malformed exact meter transport without mutation', ({ meterSegments }) => {
    const value = { ...structuredClone(canonical), meterSegments }, before = structuredClone(value);
    expect(() => parsePracticeScoreArtifact(value)).toThrow(expect.objectContaining({ code: 'practice_score_invalid' }));
    expect(value).toEqual(before);
  });
  it('requires every current root field without repairing the input', () => {
    for (const key of Object.keys(canonical)) {
      const value = structuredClone(canonical);
      Reflect.deleteProperty(value, key);
      const before = structuredClone(value);
      expect(() => parsePracticeScoreArtifact(value)).toThrow();
      expect(value).toEqual(before);
    }
  });
  it('uses the first moment for the first target when an earlier event only continues a note', () => {
    const value = structuredClone(canonical) as PracticeScoreArtifact;
    value.notes[0].tieTypes = ['stop'];
    value.moments.shift();
    parsePracticeScoreArtifact(value);
    expect(value.events[0].onsetBeat).toBe(0);
    expect(value.moments[0].onsetBeat).toBe(1);
    expect(resolvePracticeScope(value, { kind: 'FULL' }).startBeat).toBe(1);
    const runtime = new StepPracticeRuntime({ ...stepSessionPlan(value), clock: new ManualClock() });
    expect(runtime.currentTarget()?.stepId).toBe(value.moments[0].groupId);
  });
});
