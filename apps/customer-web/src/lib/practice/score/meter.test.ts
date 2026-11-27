import { describe, expect, it } from 'vitest';
import cases from '../__fixtures__/meter-duration-cases.json';
import { decodePracticeScoreArtifact } from '@/lib/practice/contracts/generated/score-artifact';
import { measureDurationTicks,  type PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import canonical from '../__fixtures__/canonical-practice-score-artifact.json';
import { countInContractAt } from '../planning/count-in';
import { resolvePracticeScope } from '../planning/scope';
import { stepPracticePlan } from '../__fixtures__/practice-plan';
import { StepPracticeSession } from '../step/domain/practice-session';
import { ManualClock } from '../session/timebase';

describe('canonical meter facts and execution policy', () => {
  it.each([
    { numerator: Number.MAX_SAFE_INTEGER, denominator: 4 },
    { numerator: 1, denominator: Number.MAX_SAFE_INTEGER },
  ])('preserves portable integer boundary facts: $numerator/$denominator', (meter) => {
    const artifact = structuredClone(canonical) as PracticeScoreArtifact;
    artifact.ticksPerQuarter = meter.denominator === 4 ? 1 : meter.denominator;
    artifact.meterSegments = [{ startTick: 0, ...meter }];
    const before = structuredClone(artifact);
    expect(measureDurationTicks(meter, artifact.ticksPerQuarter)).toBeGreaterThan(0);
    expect(decodePracticeScoreArtifact(artifact)).toBe(artifact);
    expect(artifact).toEqual(before);
  });
  it.each(['numerator', 'denominator'] as const)('rejects a nonportable %s before duration projection', (field) => {
    const meter = { numerator: Number.MAX_SAFE_INTEGER, denominator: Number.MAX_SAFE_INTEGER };
    meter[field] = Number.MAX_SAFE_INTEGER + 1;
    // The ratio is an ordinary positive duration; exact integer transport owns admission.
    expect(meter.numerator * 4 / meter.denominator).toBeCloseTo(4);
    expect(() => measureDurationTicks(meter, 1)).toThrow();
    const value = { ...structuredClone(canonical), meterSegments: [{ startTick: 0, ...meter }] };
    const before = structuredClone(value);
    expect(() => decodePracticeScoreArtifact(value)).toThrow(expect.objectContaining({ code: 'practice_score_invalid' }));
    expect(value).toEqual(before);
  });
  it('requires meter integers to retain exact semantics across JSON and browser Number', () => {
    const decoded: { n: number } = JSON.parse('{"n":9007199254740993}');
    expect(String(decoded.n)).toBe('9007199254740992');
    expect(Number.isInteger(decoded.n)).toBe(true);
    expect(Number.isSafeInteger(decoded.n)).toBe(false);
    const value = { ...structuredClone(canonical), meterSegments: [{ startTick: 0, numerator: decoded.n, denominator: 4 }] };
    expect(() => decodePracticeScoreArtifact(value)).toThrow(expect.objectContaining({ code: 'practice_score_invalid' }));
  });
  it.each(cases)('derives canonical duration from $numerator/$denominator', ({ numerator, denominator, durationTicks, ticksPerQuarter }) => {
    expect(measureDurationTicks({ numerator, denominator }, ticksPerQuarter)).toBe(durationTicks);
  });
  it.each([[3, 4, 3, 3], [6, 8, 3, 6], [2, 2, 4, 2]])('plans %s/%s Count-In independently of serialized score facts', (numerator, denominator, durationTicks, pulses) => {
    const artifact = structuredClone(canonical) as PracticeScoreArtifact;
    artifact.meterSegments = [{ startTick: 0, numerator, denominator }];
    expect(Object.keys(artifact.meterSegments[0]).sort()).toEqual(['denominator', 'numerator', 'startTick']);
    expect(countInContractAt(artifact, 0)).toEqual({ numerator, denominator, durationTicks: durationTicks * artifact.ticksPerQuarter, pulses });
  });
  it.each([
    [],
    [{ startTick: -1, numerator: 4, denominator: 4 }],
    [{ startTick: 0, numerator: true, denominator: 4 }],
    [{ startTick: 0, numerator: 3.5, denominator: 4 }],
    [{ startTick: 0, numerator: 4, denominator: 0 }],
    [{ startTick: 0, numerator: 4, denominator: NaN }],
    [{ startTick: 0, numerator: 4, denominator: '4' }],
    [{ startTick: 0, numerator: 1e308, denominator: 1 }],
    [{ startTick: 0, numerator: 1, denominator: 1e308 }],
    [{ startTick: 0, numerator: 4 }],
    [{ startTick: 0, numerator: 4, denominator: 4, unexpectedField: true }],
  ].map(meterSegments => ({ meterSegments })))('rejects malformed exact meter transport without mutation', ({ meterSegments }) => {
    const value = { ...structuredClone(canonical), meterSegments }, before = structuredClone(value);
    expect(() => decodePracticeScoreArtifact(value)).toThrow(expect.objectContaining({ code: 'practice_score_invalid' }));
    expect(value).toEqual(before);
  });
  it('requires every current root field without repairing the input', () => {
    for (const key of Object.keys(canonical)) {
      const value = structuredClone(canonical);
      Reflect.deleteProperty(value, key);
      const before = structuredClone(value);
      expect(() => decodePracticeScoreArtifact(value)).toThrow();
      expect(value).toEqual(before);
    }
  });
  it('uses the first moment for the first target when an earlier event only continues a note', () => {
    const value = structuredClone(canonical) as PracticeScoreArtifact;
    value.notes[0].tieTypes = ['stop'];
    value.moments.shift();
    decodePracticeScoreArtifact(value);
    expect(value.events[0].onsetTick).toBe(0);
    expect(value.moments[0].onsetTick).toBe(2);
    expect(resolvePracticeScope(value, { kind: 'FULL' }).startTick).toBe(2);
    const runtime = new StepPracticeSession({ plan: stepPracticePlan(value), clock: new ManualClock() });
    expect(runtime.currentTarget()?.stepId).toBe(value.moments[0].groupId);
  });
});
