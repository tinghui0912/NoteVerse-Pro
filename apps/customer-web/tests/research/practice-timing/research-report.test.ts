import { describe, expect, it } from 'vitest';
import { assertResearchReport, distribution, envelope, type SyntheticReport } from './research-report';
import { tieCase, sensitivityTable } from './policy-benchmark';

function report(): SyntheticReport {
  const cases = [tieCase()];
  return { ...envelope('SYNTHETIC_ASSIGNMENT', '2026-01-01T00:00:00.000Z'), benchmarkKind: 'SYNTHETIC_ASSIGNMENT',
    caseCount: cases.length, cases, aggregateMetrics: sensitivityTable(cases) };
}

describe('current-only research report JSON', () => {
  it('roundtrips without introducing Practice Result fields or repairing data', () => {
    const value = JSON.parse(JSON.stringify(report())), before = JSON.stringify(value);
    expect(() => assertResearchReport(value)).not.toThrow();
    expect(JSON.stringify(value)).toBe(before);
    expect(value).not.toHaveProperty('evaluation');
    expect(value).not.toHaveProperty('calibrationApplied');
  });
  it.each(['schema', 'kind', 'policy', 'window', 'date', 'count', 'negative', 'NaN', 'Infinity', 'enum', 'unknown', 'bucket'])('rejects corrupt %s without mutation', condition => {
    const value = report();
    const unknown = value as unknown as Record<string, unknown>;
    if (condition === 'schema') unknown.schemaVersion = 2;
    if (condition === 'kind') unknown.benchmarkKind = 'UNKNOWN';
    if (condition === 'policy') value.productionPolicyIdentity = 'UNKNOWN';
    if (condition === 'window') value.assignmentWindowMs++;
    if (condition === 'date') value.generatedAt = 'not a date';
    if (condition === 'count') value.caseCount = 1.5;
    if (condition === 'negative') value.cases[0].targetCount = -1;
    if (condition === 'NaN') value.cases[0].beatDurationMs = NaN;
    if (condition === 'Infinity') value.cases[0].observations[0].timingOffsetMs = Infinity;
    if (condition === 'enum') (value.cases[0].observations[0] as unknown as Record<string, unknown>).assignmentKind = 'WRONG';
    if (condition === 'unknown') unknown.compatibility = true;
    if (condition === 'bucket') value.cases[0].observations[0].claimantBucket = '0';
    const before = structuredClone(value);
    expect(() => assertResearchReport(value)).toThrow('TIMING_RESEARCH_REPORT_INVALID');
    expect(value).toEqual(before);
  });
  it('uses explicit empty distributions rather than NaN or fabricated samples', () => {
    expect(distribution([])).toEqual({ count: 0, min: null, p50: null, p90: null, p99: null, max: null });
    expect(distribution([5, 1, 3])).toEqual({ count: 3, min: 1, p50: 3, p90: 3, p99: 3, max: 5 });
  });
});
