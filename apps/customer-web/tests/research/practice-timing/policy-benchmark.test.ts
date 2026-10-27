import { beforeAll, describe, expect, it } from 'vitest';
import { MIN_PRACTICE_TEMPO_BPM, MAX_PRACTICE_TEMPO_BPM } from '@/lib/practice/kernel/tempo';
import { CONTINUOUS_ASSIGNMENT_WINDOW_MS } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { benchmarkTempo, characterizeCase, expectedPattern, fixedTimeline, offsetSweepMs, patternFamilies,
  runSyntheticBenchmark, spacingGrid, tempoGrid, tieCase, transitionCases } from './policy-benchmark';
import { assertResearchReport, envelope, type SyntheticReport } from './research-report';

describe('production timing policy characterization', () => {
  it('uses product tempo endpoints and the full deterministic offset matrix', () => {
    expect(tempoGrid).toEqual([MIN_PRACTICE_TEMPO_BPM, 60, 80, 100, 120, 160, 200, MAX_PRACTICE_TEMPO_BPM]);
    expect(spacingGrid).toEqual([2, 1, 0.5, 1 / 3, 0.25]);
    expect(offsetSweepMs).toEqual([0, ...[10, 25, 50, 75, 100, 125, 150, 200, 249, 250, 251, 300].flatMap(ms => [-ms, ms])]);
  });
  it.each(tempoGrid)('runs all families/spacings/offsets at %i BPM with stable golden controls', bpm => {
    const cases = benchmarkTempo(bpm);
    expect(cases).toHaveLength(1250);
    expect(new Set(cases.map(c => c.family))).toEqual(new Set(Object.keys(patternFamilies)));
    expect(new Set(cases.map(c => c.spacingBeats))).toEqual(new Set(spacingGrid));
    expect(new Set(cases.flatMap(c => c.observations.map(o => o.generatedOffsetMs)))).toEqual(new Set(offsetSweepMs));
    const controls = cases.filter(c => c.family === 'ISOLATED_NOTE' && c.observations[0].generatedOffsetMs === 0);
    expect(controls).toHaveLength(spacingGrid.length);
    for (const c of controls) {
      expect(c).toMatchObject({ matchedCount: 1, unmatchedCount: 0 });
      expect(c.observations[0]).toMatchObject({ assignmentKind: 'STRIKE_MATCH', timingOffsetMs: 0, claimantCount: 1, neighborMisassignment: false });
    }
    const report = { ...envelope('SYNTHETIC_ASSIGNMENT', '2026-01-01T00:00:00.000Z'), benchmarkKind: 'SYNTHETIC_ASSIGNMENT',
      caseCount: cases.length, cases, aggregateMetrics: [] };
    expect(() => assertResearchReport(report)).not.toThrow();
  });
  it.each(tempoGrid)('maps beat spacing through the real tempo timeline at %i BPM', bpm => {
    const timeline = fixedTimeline(bpm);
    const duration = timeline.beatToTimeMs(5) - timeline.beatToTimeMs(4);
    expect(duration).toBeCloseTo(60_000 / bpm, 8);
    for (const spacing of spacingGrid) {
      const strikes = expectedPattern(timeline, [['C4'], ['C4']], spacing);
      expect(strikes[1].expectedPerformanceTimeMs - strikes[0].expectedPerformanceTimeMs).toBeCloseTo(duration * spacing, 8);
    }
  });
  it.each([-251, -250, 250, 251])('keeps the inclusive direct boundary at offset %i', offsetMs => {
    const timeline = fixedTimeline(120), strikes = expectedPattern(timeline, [['C4']], 1);
    const c = characterizeCase({ caseId: 'boundary', family: 'ISOLATED_NOTE', variant: 'CONTROL', bpm: 120,
      spacingBeats: 1, timeline, strikes, probes: [{ intendedStrikeId: strikes[0].strikeId, offsetMs }] });
    const legal = Math.abs(offsetMs) <= CONTINUOUS_ASSIGNMENT_WINDOW_MS;
    expect(c.observations[0].claimantCount).toBe(legal ? 1 : 0);
    expect(c.observations[0].assignmentKind).toBe(legal ? 'STRIKE_MATCH' : 'UNATTRIBUTED');
  });
  it.each([0, 1])('exposes both repeated-pitch intended identities, legal claimants and neighbor sensitivity: %i', index => {
    const timeline = fixedTimeline(120), strikes = expectedPattern(timeline, [['C4'], ['C4']], 0.5);
    const c = characterizeCase({ caseId: 'neighbor', family: 'REPEATED', variant: 'PROBE', bpm: 120,
      spacingBeats: 0.5, timeline, strikes, probes: [{ intendedStrikeId: strikes[index].strikeId, offsetMs: index === 0 ? 200 : -200 }] });
    expect(c.observations[0]).toMatchObject({ claimantCount: 2, claimantBucket: '2+', neighborMisassignment: true,
      assignedStrikeId: strikes[1 - index].strikeId });
    expect(c.overlappingSamePitchGapCount).toBe(1);
  });
  it('marks an exact equal-distance tie and preserves stable strike identity despite input order', () => {
    const c = tieCase();
    expect(c.tag).toBe('TIE_CASE');
    expect(c.observations[0]).toMatchObject({ assignedStrikeId: 'g0:C4', claimantCount: 2, timingOffsetMs: CONTINUOUS_ASSIGNMENT_WINDOW_MS });
    const timeline = fixedTimeline(120), strikes = expectedPattern(timeline, [['C4'], ['C4']], 1).reverse();
    const reversed = characterizeCase({ caseId: c.caseId, family: c.family, variant: c.variant, bpm: 120, spacingBeats: 1,
      timeline, strikes, tag: 'TIE_CASE', probes: [{ intendedStrikeId: 'g1:C4', offsetMs: -CONTINUOUS_ASSIGNMENT_WINDOW_MS }] });
    expect(reversed).toEqual(c);
  });
  it.each([1, 1.01])('derives cohort overlap from twice the production window: spacing %s beats', spacingBeats => {
    const timeline = fixedTimeline(120), strikes = expectedPattern(timeline, [['C4'], ['C4']], spacingBeats);
    const c = characterizeCase({ caseId: 'cohort', family: 'REPEATED', variant: 'CONTROL', bpm: 120,
      spacingBeats, timeline, strikes, probes: [] });
    expect(c.overlappingSamePitchGapCount).toBe(spacingBeats === 1 ? 1 : 0);
  });
  it('characterizes maximum cardinality before timing cost using the real finalizer', () => {
    const timeline = fixedTimeline(120), strikes = expectedPattern(timeline, [['C4'], ['C4']], 0.5);
    const c = characterizeCase({ caseId: 'cardinality', family: 'REPEATED', variant: 'CONTROL', bpm: 120, spacingBeats: 0.5,
      timeline, strikes, probes: [{ intendedStrikeId: 'g0:C4', offsetMs: 100 }, { intendedStrikeId: 'g1:C4', offsetMs: -450 }] });
    expect(c.matchedCount).toBe(2);
    expect(c.observations.map(o => o.assignedStrikeId)).toEqual(['g1:C4', 'g0:C4']);
  });
  it('selects minimum total absolute timing error within maximum-cardinality matching', () => {
    const timeline = fixedTimeline(120), strikes = expectedPattern(timeline, [['C4'], ['C4']], 0.5);
    const c = characterizeCase({ caseId: 'cost', family: 'REPEATED', variant: 'CONTROL', bpm: 120, spacingBeats: 0.5,
      timeline, strikes, probes: [{ intendedStrikeId: 'g0:C4', offsetMs: 10 }, { intendedStrikeId: 'g1:C4', offsetMs: -10 }] });
    expect(c.observations.map(o => o.assignedStrikeId)).toEqual(['g0:C4', 'g1:C4']);
    expect(c.observations.map(o => o.timingOffsetMs)).toEqual([10, -10]);
  });
  it.each(tempoGrid)('retains chord residual-slot behavior at %i BPM', bpm => {
    const timeline = fixedTimeline(bpm), strikes = expectedPattern(timeline, [['C4', 'E4', 'G4']], 1);
    const c = characterizeCase({ caseId: 'residual', family: 'CHORD', variant: 'CONTROL', bpm, spacingBeats: 1,
      timeline, strikes, probes: strikes.map(s => ({ intendedStrikeId: s.strikeId, offsetMs: 0, pitch: s.pitch === 'G4' ? 'A4' : s.pitch })) });
    expect(c).toMatchObject({ matchedCount: 2, unmatchedCount: 1 });
    expect(c.observations[2]).toMatchObject({ assignmentKind: 'GROUP_RESIDUAL', assignedStrikeId: 'g0:G4', claimantCount: 0, timingOffsetMs: 0 });
  });
  it('characterizes an 80→160 tempo boundary without changing a physical window', () => {
    const [before, after] = transitionCases();
    expect(before.assignmentWindowBeats).toBeCloseTo(1 / 3);
    expect(after.assignmentWindowBeats).toBeCloseTo(2 / 3);
    expect(before.observations[0].timingOffsetMs).toBe(CONTINUOUS_ASSIGNMENT_WINDOW_MS);
    expect(after.observations[0].timingOffsetMs).toBe(CONTINUOUS_ASSIGNMENT_WINDOW_MS);
  });
  describe('complete matrix report', () => {
    const date = '2026-01-01T00:00:00.000Z';
    let report: SyntheticReport;
    beforeAll(() => { report = runSyntheticBenchmark(date); });
    it('generates the entire production-policy matrix with fixed report metadata', () => {
      expect(report.caseCount).toBe(10003);
      expect(report.aggregateMetrics).toHaveLength(tempoGrid.length * spacingGrid.length);
      expect(report.generatedAt).toBe(date);
    });
    it('validates every case and aggregate after a complete JSON roundtrip', () => {
      expect(() => assertResearchReport(JSON.parse(JSON.stringify(report)))).not.toThrow();
    });
    it('emits byte-identical case JSON for deterministic repeated generation', () => {
      expect(JSON.stringify(benchmarkTempo(120))).toBe(JSON.stringify(benchmarkTempo(120)));
    });
  });
});
