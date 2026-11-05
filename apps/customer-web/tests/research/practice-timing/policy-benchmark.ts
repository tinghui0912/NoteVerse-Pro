import { PracticeTempoTimeline, MIN_PRACTICE_TEMPO_BPM, MAX_PRACTICE_TEMPO_BPM } from '@/lib/practice/planning/tempo';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import { assertCompletedAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-projection';
import { directObservationClaimants, directStrikeCohort, directStrikeFrontier } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import type { ContinuousExpectedStrike } from '@/lib/practice/continuous/domain/evaluation/assignment-types';
import type { ContinuousEvidencePublication } from '@/lib/practice/continuous/domain/evaluation/evidence-types';
import { envelope, type SyntheticCase, type SyntheticReport, type SensitivityRow } from './research-report';
import { productionPolicy } from './production-policy';

export const tempoGrid = [MIN_PRACTICE_TEMPO_BPM, 60, 80, 100, 120, 160, 200, MAX_PRACTICE_TEMPO_BPM];
export const spacingGrid = [2, 1, 1 / 2, 1 / 3, 1 / 4];
export const offsetSweepMs = [0, ...[10, 25, 50, 75, 100, 125, 150, 200, 249, 250, 251, 300].flatMap(ms => [-ms, ms])];
export const patternFamilies = {
  ISOLATED_NOTE: [[60]],
  SAME_PITCH_REPEATED_NOTES: [[60], [60], [60], [60]],
  ALTERNATING_PITCHES: [[60], [62], [60], [62]],
  SAME_PITCH_REPEATED_GROUPS: [[60], [60], [60]],
  CHORD_REPEATED_CHORD: [[60, 64, 67], [60, 64, 67], [60, 64, 67]],
  CHORD_ONE_REPEATED_MEMBER: [[60, 64, 67], [60, 65, 69], [60, 64, 67]],
  DENSE_NEIGHBORING_GROUPS: [[60, 64], [62, 65], [60, 67], [62, 65]],
  CHORD_SUBSTITUTION: [[60, 64, 67]],
} as const;

/** Research input spacings are quarter quantities; production receives integral grid positions. */
function researchQuarterTicks(quarters: number): number {
  const ticks = quarters === 1 / 3 ? 100 : quarters * 300;
  if (!Number.isSafeInteger(ticks)) throw new Error('RESEARCH_GRID_UNREPRESENTABLE');
  return ticks;
}

export function fixedTimeline(bpm: number): PracticeTempoTimeline {
  return new PracticeTempoTimeline({ selection: { mode: 'CUSTOM_FIXED_BPM', bpm },
    segments: [{ startTick: 0, bpm, source: 'CUSTOM' }] }, 9600, 300);
}

export function expectedPattern(timeline: PracticeTempoTimeline, groups: readonly (readonly number[])[], spacingBeats: number, startQuarter = 4): ContinuousExpectedStrike[] {
  return groups.flatMap((pianoKeys, group) => pianoKeys.map(pianoKey => ({
    strikeId: `g${group}:${pianoKey}`, groupId: `g${group}`, pianoKey,
    expectedPerformanceTimeMs: timeline.tickToTimeMs(researchQuarterTicks(startQuarter) + group * researchQuarterTicks(spacingBeats)), renderNoteIds: [],
  })));
}

type Probe = { intendedStrikeId: string; offsetMs: number; pianoKey?: number };
type CaseInput = { caseId: string; family: string; variant: string; bpm: number; spacingBeats: number;
  timeline: PracticeTempoTimeline; strikes: ContinuousExpectedStrike[]; probes: Probe[]; atBeat?: number; tag?: 'TIE_CASE' };

/** Intended identity belongs only to this fixture. The finalizer sees ordinary production evidence. */
export function characterizeCase(input: CaseInput): SyntheticCase {
  const { strikes, timeline } = input;
  const observations = input.probes.map((probe, index) => {
    const strike = strikes.find(strike => strike.strikeId === probe.intendedStrikeId);
    if (!strike) throw new Error('RESEARCH_INTENDED_STRIKE_INVALID');
    return { observationId: `o${index}`, pianoKey: probe.pianoKey ?? strike.pianoKey,
      performanceTimeMs: strike.expectedPerformanceTimeMs + probe.offsetMs, confidence: 1, source: 'MIDI' as const };
  });
  const terminal = Math.max(...strikes.map(strike => strike.expectedPerformanceTimeMs),
    ...observations.map(observation => observation.performanceTimeMs), ...strikes.map(strike => directStrikeFrontier(strike, strikes)));
  const finalizer = new ContinuousAssignmentFinalizer('research', strikes);
  const publication: ContinuousEvidencePublication = {
    publicationId: 'batch', sessionDomainId: 'research', analyzedThroughPerformanceMs: terminal,
    availabilitySessionTimeMs: terminal, observations,
  };
  finalizer.publish(publication);
  finalizer.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: terminal, availabilitySessionTimeMs: terminal });
  const result = finalizer.completedAssignment();
  if (result.status !== 'COMPLETE') throw new Error('RESEARCH_INCOMPLETE_ASSIGNMENT');
  assertCompletedAssignment(result.assignment);
  const assignedStrikes = result.assignment.groups.flatMap(group => group.strikes);
  const samePitchGaps: { previous: ContinuousExpectedStrike; next: ContinuousExpectedStrike }[] = [];
  const previousByPitch = new Map<number, ContinuousExpectedStrike>();
  for (const strike of [...strikes].sort((a, b) => a.expectedPerformanceTimeMs - b.expectedPerformanceTimeMs)) {
    const previous = previousByPitch.get(strike.pianoKey);
    if (previous) samePitchGaps.push({ previous, next: strike });
    previousByPitch.set(strike.pianoKey, strike);
  }
  const atBeat = input.atBeat ?? 4;
  const beatDurationMs = timeline.tickToTimeMs(researchQuarterTicks(atBeat + 1)) - timeline.tickToTimeMs(researchQuarterTicks(atBeat));
  return {
    caseId: input.caseId, family: input.family, variant: input.variant, bpm: input.bpm, spacingBeats: input.spacingBeats,
    samePitchSpacingMs: samePitchGaps.length ? Math.min(...samePitchGaps.map(({ previous, next }) => next.expectedPerformanceTimeMs - previous.expectedPerformanceTimeMs)) : null,
    beatDurationMs, assignmentWindowBeats: productionPolicy.assignmentWindowMs / beatDurationMs,
    tag: input.tag ?? null, targetCount: strikes.length,
    matchedCount: assignedStrikes.filter(strike => strike.state === 'MATCHED').length,
    unmatchedCount: assignedStrikes.filter(strike => strike.state === 'UNMATCHED').length,
    samePitchGapCount: samePitchGaps.length,
    overlappingSamePitchGapCount: samePitchGaps.filter(({ previous, next }) => directStrikeCohort(previous, strikes).some(strike => strike.strikeId === next.strikeId)).length,
    observations: observations.map((observation, index) => {
      const intendedStrikeId = input.probes[index].intendedStrikeId;
      const relation = result.assignment.observationAssignments.find(row => row.observationId === observation.observationId)!;
      const assignedStrikeId = relation.kind === 'UNATTRIBUTED' ? null : relation.strikeId;
      const assigned = assignedStrikes.find(strike => strike.strikeId === assignedStrikeId);
      const claimantCount = directObservationClaimants(observation, strikes).length;
      const intended = assignedStrikes.find(strike => strike.strikeId === intendedStrikeId)!;
      if (intended.state === 'NOT_REACHED') throw new Error('RESEARCH_UNEXPECTED_NOT_REACHED');
      return { observationId: observation.observationId, intendedStrikeId, assignedStrikeId, assignmentKind: relation.kind,
        observedKey: observation.pianoKey, intendedPerformanceTimeMs: intended.expectedPerformanceTimeMs,
        observationPerformanceTimeMs: observation.performanceTimeMs, assignedPerformanceTimeMs: assigned?.expectedPerformanceTimeMs ?? null,
        intendedStrikeState: intended.state, generatedOffsetMs: input.probes[index].offsetMs,
        timingOffsetMs: relation.kind === 'STRIKE_MATCH' && assigned?.state === 'MATCHED' ? assigned.match.timingOffsetMs : null,
        claimantCount, claimantBucket: claimantCount === 0 ? '0' : claimantCount === 1 ? '1' : '2+',
        neighborMisassignment: relation.kind === 'STRIKE_MATCH' && assignedStrikeId !== intendedStrikeId,
        unattributed: relation.kind === 'UNATTRIBUTED',
      };
    }),
  };
}

export function sensitivityTable(cases: readonly SyntheticCase[]): SensitivityRow[] {
  const grouped = new Map<string, SyntheticCase[]>();
  // Only the full uniform-offset matrix enters this table; probe/control experiments stay separate.
  for (const c of cases.filter(c => c.variant === 'FULL_SWEEP')) {
    const key = `${c.bpm}:${c.spacingBeats}`;
    grouped.set(key, [...(grouped.get(key) ?? []), c]);
  }
  return [...grouped.values()].map(rows => {
    const observations = rows.flatMap(row => row.observations);
    const count = (test: (o: typeof observations[number]) => boolean) => observations.filter(test).length;
    const claimantOverlapCount = count(o => o.claimantCount >= 2);
    const neighborMisassignmentCount = count(o => o.neighborMisassignment);
    const unattributedCount = count(o => o.unattributed);
    const first = rows[0];
    return { bpm: first.bpm, spacingBeats: first.spacingBeats, beatDurationMs: first.beatDurationMs,
      assignmentWindowBeats: first.assignmentWindowBeats, groupSpacingMs: first.beatDurationMs * first.spacingBeats,
      caseCount: rows.length, observationCount: observations.length,
      claimantZeroCount: count(o => o.claimantCount === 0), claimantOneCount: count(o => o.claimantCount === 1), claimantOverlapCount,
      neighborMisassignmentCount, unattributedCount, samePitchGapCount: rows.reduce((n, row) => n + row.samePitchGapCount, 0),
      overlappingSamePitchGapCount: rows.reduce((n, row) => n + row.overlappingSamePitchGapCount, 0),
      claimantOverlapRate: claimantOverlapCount / observations.length,
      neighborMisassignmentRate: neighborMisassignmentCount / observations.length, unattributedRate: unattributedCount / observations.length };
  });
}

export function benchmarkTempo(bpm: number): SyntheticCase[] {
  if (!tempoGrid.includes(bpm)) throw new Error('RESEARCH_TEMPO_INVALID');
  const timeline = fixedTimeline(bpm);
  const cases: SyntheticCase[] = [];
  for (const spacingBeats of spacingGrid) {
    for (const [family, groups] of Object.entries(patternFamilies)) {
      const strikes = expectedPattern(timeline, groups, spacingBeats);
      for (const offsetMs of offsetSweepMs) {
        const input = { caseId: `${bpm}/${spacingBeats}/${family}/${offsetMs}`, bpm, spacingBeats, family, timeline, strikes };
        cases.push(characterizeCase({ ...input, variant: 'FULL_SWEEP', probes: strikes.map(strike => ({
          intendedStrikeId: strike.strikeId, offsetMs, ...(family === 'CHORD_SUBSTITUTION' && strike.pianoKey === 67 ? { pianoKey: 69 } : {}),
        })) }));
        if (family === 'SAME_PITCH_REPEATED_NOTES') {
          for (const strike of [strikes[0], strikes[1]]) cases.push(characterizeCase({ ...input,
            caseId: `${input.caseId}/probe/${strike.strikeId}`, variant: 'SINGLE_PROBE', probes: [{ intendedStrikeId: strike.strikeId, offsetMs }] }));
        }
      }
    }
  }
  // Fail immediately if a golden exact isolated control is unstable at this BPM.
  if (cases.some(c => c.family === 'ISOLATED_NOTE' && c.observations[0].generatedOffsetMs === 0
    && (c.matchedCount !== 1 || c.observations[0].assignedStrikeId !== c.observations[0].intendedStrikeId))) {
    throw new Error('RESEARCH_GOLDEN_CONTROL_FAILED');
  }
  return cases;
}

export function tieCase(): SyntheticCase {
  const timeline = fixedTimeline(120);
  const strikes = expectedPattern(timeline, [[60], [60]], 1);
  return characterizeCase({ caseId: 'stable-tie', family: 'SAME_PITCH_REPEATED_NOTES', variant: 'MIDPOINT_PROBE',
    bpm: 120, spacingBeats: 1, timeline, strikes, tag: 'TIE_CASE',
    probes: [{ intendedStrikeId: strikes[1].strikeId, offsetMs: -productionPolicy.assignmentWindowMs }] });
}

export function transitionCases(): SyntheticCase[] {
  const timeline = new PracticeTempoTimeline({ selection: { mode: 'SCORE' }, segments: [
    { startTick: 0, bpm: 80, source: 'MUSICXML' }, { startTick: 2400, bpm: 160, source: 'MUSICXML' },
  ] }, 4800, 300);
  return [7, 8].map(beat => {
    const strikes = expectedPattern(timeline, [[60]], 1, beat);
    return characterizeCase({ caseId: `transition-${beat}`, family: 'TEMPO_TRANSITION', variant: 'TRANSITION_CONTROL',
      timeline, strikes, bpm: timeline.bpmAtTick(researchQuarterTicks(beat)), spacingBeats: 1, atBeat: beat,
      probes: [{ intendedStrikeId: strikes[0].strikeId, offsetMs: productionPolicy.assignmentWindowMs }] });
  });
}

export function runSyntheticBenchmark(generatedAt = new Date().toISOString()): SyntheticReport {
  const cases = [...tempoGrid.flatMap(benchmarkTempo), tieCase(), ...transitionCases()];
  return { ...envelope('SYNTHETIC_ASSIGNMENT', generatedAt), benchmarkKind: 'SYNTHETIC_ASSIGNMENT',
    caseCount: cases.length, cases, aggregateMetrics: sensitivityTable(cases) };
}
