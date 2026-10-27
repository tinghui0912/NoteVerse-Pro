import { productionPolicy } from './production-policy';

const limitations = [
  'Synthetic benchmark tests NoteVerse policy behavior against known generated ground truth.',
  'MIDI corpus analysis characterizes real performance spacing only, not score-aligned assignment accuracy.',
  'Neither measures physical keyboard-to-browser latency.',
  'Corpus NOTE_ON counts use Tone parsed paired positive-velocity note starts, not raw wire-message counts; unpaired starts are not represented.',
];
export type ResearchKind = 'SYNTHETIC_ASSIGNMENT' | 'MIDI_CORPUS_SPACING';
export type ResearchEnvelope = {
  schemaVersion: 1; generatedAt: string; benchmarkKind: ResearchKind;
  productionPolicyIdentity: string; assignmentWindowMs: number; cohortOverlapThresholdMs: number;
  limitations: string[];
};
type ObservationOutcome = {
  observationId: string; intendedStrikeId: string; assignedStrikeId: string | null;
  observedPitch: string; intendedPerformanceTimeMs: number; observationPerformanceTimeMs: number;
  assignedPerformanceTimeMs: number | null;
  assignmentKind: 'STRIKE_MATCH' | 'GROUP_RESIDUAL' | 'UNATTRIBUTED';
  intendedStrikeState: 'MATCHED' | 'UNMATCHED';
  timingOffsetMs: number | null; generatedOffsetMs: number;
  claimantCount: number; claimantBucket: '0' | '1' | '2+';
  neighborMisassignment: boolean; unattributed: boolean;
};
export type SyntheticCase = {
  caseId: string; family: string; variant: string; bpm: number; spacingBeats: number;
  samePitchSpacingMs: number | null; beatDurationMs: number; assignmentWindowBeats: number;
  tag: 'TIE_CASE' | null; targetCount: number; matchedCount: number; unmatchedCount: number;
  samePitchGapCount: number; overlappingSamePitchGapCount: number;
  observations: ObservationOutcome[];
};
export type SensitivityRow = {
  bpm: number; spacingBeats: number; beatDurationMs: number; assignmentWindowBeats: number;
  groupSpacingMs: number; caseCount: number; observationCount: number;
  claimantZeroCount: number; claimantOneCount: number; claimantOverlapCount: number;
  neighborMisassignmentCount: number; unattributedCount: number;
  samePitchGapCount: number; overlappingSamePitchGapCount: number;
  claimantOverlapRate: number; neighborMisassignmentRate: number; unattributedRate: number;
};
export type SyntheticReport = ResearchEnvelope & {
  benchmarkKind: 'SYNTHETIC_ASSIGNMENT'; caseCount: number; cases: SyntheticCase[]; aggregateMetrics: SensitivityRow[];
};
export type Distribution = { count: number; min: number | null; p50: number | null; p90: number | null; p99: number | null; max: number | null };
export type CorpusFailure = { path: string; category: 'INVALID_MIDI' | 'READ_FAILED' | 'DISCOVERY_FAILED' | 'UNSUPPORTED_INPUT' };
export type CorpusReport = ResearchEnvelope & {
  benchmarkKind: 'MIDI_CORPUS_SPACING'; dataset: { name: string; version: string; sourceNote: string };
  caseCount: number; totalMidiFiles: number; filesSucceeded: number; filesFailed: number;
  failures: CorpusFailure[];
  aggregateMetrics: {
    totalNoteOnCount: number; explicitTempoEventCount: number; implicitTempoNoteCount: number;
    samePitchGapCount: number; samePitchGapsWithinCohortCount: number; normalizedSamePitchGapCount: number;
    interOnsetIntervalMs: Distribution; samePitchGapMs: Distribution; samePitchGapLocalBeats: Distribution;
    noteWeightedLocalTempoBpm: Distribution;
  };
};
export type TimingResearchReport = SyntheticReport | CorpusReport;

export function envelope(benchmarkKind: ResearchKind, generatedAt: string): ResearchEnvelope {
  return { schemaVersion: 1, benchmarkKind, generatedAt, ...productionPolicy, limitations: [...limitations] };
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (q: number) => sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null;
  return { count: sorted.length, min: quantile(0), p50: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99), max: quantile(1) };
}

function fail(): never { throw new Error('TIMING_RESEARCH_REPORT_INVALID'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function fields(value: unknown, names: string): Record<string, unknown> {
  const row = object(value);
  if (Object.keys(row).sort().join() !== names.split(' ').sort().join()) fail();
  return row;
}
function array(value: unknown): unknown[] { if (!Array.isArray(value)) fail(); return value; }
function text(value: unknown): void { if (typeof value !== 'string') fail(); }
function number(value: unknown, signed = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !signed && value < 0) fail();
}
function count(value: unknown): void { number(value); if (!Number.isSafeInteger(value)) fail(); }
function boolean(value: unknown): void { if (typeof value !== 'boolean') fail(); }
function enumValue(value: unknown, choices: readonly unknown[]): void { if (!choices.includes(value)) fail(); }
function numericFields(row: Record<string, unknown>, keys: string): void {
  for (const key of keys.split(' ')) number(row[key]);
}

/** Research JSON is a separate, strict, current-only artifact. This never repairs input. */
export function assertResearchReport(value: unknown): asserts value is TimingResearchReport {
  const row = object(value);
  enumValue(row.schemaVersion, [1]);
  enumValue(row.benchmarkKind, ['SYNTHETIC_ASSIGNMENT', 'MIDI_CORPUS_SPACING']);
  text(row.generatedAt);
  if (typeof row.generatedAt !== 'string' || !Number.isFinite(Date.parse(row.generatedAt))) fail();
  if (row.productionPolicyIdentity !== productionPolicy.productionPolicyIdentity
    || row.assignmentWindowMs !== productionPolicy.assignmentWindowMs
    || row.cohortOverlapThresholdMs !== productionPolicy.cohortOverlapThresholdMs) fail();
  if (JSON.stringify(row.limitations) !== JSON.stringify(limitations)) fail();
  count(row.caseCount);
  const common = 'schemaVersion generatedAt benchmarkKind productionPolicyIdentity assignmentWindowMs cohortOverlapThresholdMs limitations caseCount aggregateMetrics';
  if (row.benchmarkKind === 'SYNTHETIC_ASSIGNMENT') {
    fields(row, `${common} cases`);
    const cases = array(row.cases);
    if (row.caseCount !== cases.length) fail();
    for (const item of cases) {
      const c = fields(item, 'caseId family variant bpm spacingBeats samePitchSpacingMs beatDurationMs assignmentWindowBeats tag targetCount matchedCount unmatchedCount samePitchGapCount overlappingSamePitchGapCount observations');
      for (const key of ['caseId', 'family', 'variant']) text(c[key]);
      numericFields(c, 'bpm spacingBeats beatDurationMs assignmentWindowBeats');
      if (c.samePitchSpacingMs !== null) number(c.samePitchSpacingMs);
      enumValue(c.tag, [null, 'TIE_CASE']);
      for (const key of ['targetCount', 'matchedCount', 'unmatchedCount', 'samePitchGapCount', 'overlappingSamePitchGapCount']) count(c[key]);
      if (Number(c.matchedCount) + Number(c.unmatchedCount) !== c.targetCount
        || Number(c.overlappingSamePitchGapCount) > Number(c.samePitchGapCount)) fail();
      for (const item of array(c.observations)) {
        const o = fields(item, 'observationId intendedStrikeId assignedStrikeId observedPitch intendedPerformanceTimeMs observationPerformanceTimeMs assignedPerformanceTimeMs assignmentKind intendedStrikeState timingOffsetMs generatedOffsetMs claimantCount claimantBucket neighborMisassignment unattributed');
        text(o.observationId); text(o.intendedStrikeId); if (o.assignedStrikeId !== null) text(o.assignedStrikeId);
        text(o.observedPitch); numericFields(o, 'intendedPerformanceTimeMs observationPerformanceTimeMs');
        if (o.assignedPerformanceTimeMs !== null) number(o.assignedPerformanceTimeMs);
        enumValue(o.assignmentKind, ['STRIKE_MATCH', 'GROUP_RESIDUAL', 'UNATTRIBUTED']);
        enumValue(o.intendedStrikeState, ['MATCHED', 'UNMATCHED']);
        if (o.timingOffsetMs !== null) number(o.timingOffsetMs, true);
        number(o.generatedOffsetMs, true); count(o.claimantCount);
        enumValue(o.claimantBucket, [Number(o.claimantCount) > 1 ? '2+' : String(o.claimantCount)]);
        boolean(o.neighborMisassignment); boolean(o.unattributed);
        if (o.unattributed !== (o.assignmentKind === 'UNATTRIBUTED')
          || (o.assignedStrikeId === null) !== o.unattributed
          || (o.assignedPerformanceTimeMs === null) !== o.unattributed
          || (o.timingOffsetMs === null) !== o.unattributed
          || o.neighborMisassignment !== (o.assignmentKind === 'STRIKE_MATCH' && o.assignedStrikeId !== o.intendedStrikeId)) fail();
      }
    }
    for (const item of array(row.aggregateMetrics)) {
      const a = fields(item, 'bpm spacingBeats beatDurationMs assignmentWindowBeats groupSpacingMs caseCount observationCount claimantZeroCount claimantOneCount claimantOverlapCount neighborMisassignmentCount unattributedCount samePitchGapCount overlappingSamePitchGapCount claimantOverlapRate neighborMisassignmentRate unattributedRate');
      for (const [key, value] of Object.entries(a)) {
        if (key.endsWith('Count')) count(value); else number(value);
        if (key.endsWith('Rate') && Number(value) > 1) fail();
      }
      if (Number(a.claimantZeroCount) + Number(a.claimantOneCount) + Number(a.claimantOverlapCount) !== a.observationCount) fail();
    }
  } else {
    fields(row, `${common} dataset totalMidiFiles filesSucceeded filesFailed failures`);
    const dataset = fields(row.dataset, 'name version sourceNote'); Object.values(dataset).forEach(text);
    for (const key of ['totalMidiFiles', 'filesSucceeded', 'filesFailed']) count(row[key]);
    if (row.caseCount !== row.totalMidiFiles || Number(row.filesSucceeded) + Number(row.filesFailed) !== row.totalMidiFiles
      || array(row.failures).length !== row.filesFailed) fail();
    for (const item of array(row.failures)) {
      const f = fields(item, 'path category'); text(f.path);
      enumValue(f.category, ['INVALID_MIDI', 'READ_FAILED', 'DISCOVERY_FAILED', 'UNSUPPORTED_INPUT']);
    }
    const a = fields(row.aggregateMetrics, 'totalNoteOnCount explicitTempoEventCount implicitTempoNoteCount samePitchGapCount samePitchGapsWithinCohortCount normalizedSamePitchGapCount interOnsetIntervalMs samePitchGapMs samePitchGapLocalBeats noteWeightedLocalTempoBpm');
    for (const [key, value] of Object.entries(a)) {
      if (key.endsWith('Count')) count(value);
      else {
        const d = fields(value, 'count min p50 p90 p99 max'); count(d.count);
        const quantiles = ['min', 'p50', 'p90', 'p99', 'max'].map(key => d[key]);
        if (d.count === 0) { if (quantiles.some(value => value !== null)) fail(); }
        else {
          quantiles.forEach(value => number(value));
          if (quantiles.some((value, index) => index > 0 && Number(value) < Number(quantiles[index - 1]))) fail();
        }
      }
    }
    if (Number(a.samePitchGapsWithinCohortCount) > Number(a.samePitchGapCount)
      || object(a.samePitchGapMs).count !== a.samePitchGapCount
      || object(a.samePitchGapLocalBeats).count !== a.normalizedSamePitchGapCount) fail();
  }
}
