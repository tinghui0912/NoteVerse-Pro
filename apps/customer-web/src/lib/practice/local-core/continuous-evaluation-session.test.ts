import { describe, expect, it } from 'vitest';

import canonicalArtifactJson from './__fixtures__/canonical-practice-score-artifact.json';
import { ContinuousEvaluationSession, type PracticeScoreArtifact } from './index';
import type { ObservedAttack } from '../audio-analysis/continuous/observed-attack';

const baseArtifact = canonicalArtifactJson as PracticeScoreArtifact;
const identityTimeline = {
  beatToTimeMs(beat: number): number {
    return beat * 1000;
  },
};

function session(
  groups: readonly { id: string; timeMs: number; pitches: readonly string[]; durationMs?: number }[],
  assignmentWindowMs = 250
): ContinuousEvaluationSession {
  return new ContinuousEvaluationSession({
    artifact: artifactFor(groups),
    timeline: identityTimeline,
    scope: { kind: 'FULL' },
    assignmentWindowMs,
  });
}

function artifactFor(
  groups: readonly { id: string; timeMs: number; pitches: readonly string[]; durationMs?: number }[]
): PracticeScoreArtifact {
  const artifact = structuredClone(baseArtifact) as PracticeScoreArtifact;
  artifact.expectedPracticeGroups = groups.map((group, index) => {
    const template = structuredClone(baseArtifact.expectedPracticeGroups[Math.min(index, baseArtifact.expectedPracticeGroups.length - 1)]);
    const onsetBeat = group.timeMs / 1000;
    const durationBeat = (group.durationMs ?? 250) / 1000;
    return {
      ...template,
      groupId: group.id,
      onsetBeat,
      canonicalEndBeat: onsetBeat + durationBeat,
      pitches: [...group.pitches],
      renderNoteIds: group.pitches.map((pitch, pitchIndex) => `${group.id}:note:${pitch}:${pitchIndex}`),
      strikeTargets: group.pitches.map((pitch, pitchIndex) => ({
        ...template.strikeTargets[Math.min(pitchIndex, template.strikeTargets.length - 1)],
        pitch,
        strikeId: `${group.id}:strike:${pitch}:${pitchIndex}`,
        renderNoteIds: [`${group.id}:note:${pitch}:${pitchIndex}`],
        expectedNotes: [{
          eventId: `${group.id}:event`,
          expectedNoteId: `${group.id}:expected:${pitch}:${pitchIndex}`,
          measureNumbers: ['1'],
          pitch,
          renderNoteId: `${group.id}:note:${pitch}:${pitchIndex}`,
        }],
      })),
      expectedNotes: group.pitches.map((pitch, pitchIndex) => ({
        eventId: `${group.id}:event`,
        expectedNoteId: `${group.id}:expected:${pitch}:${pitchIndex}`,
        measureNumbers: ['1'],
        pitch,
        renderNoteId: `${group.id}:note:${pitch}:${pitchIndex}`,
      })),
    };
  });
  artifact.practiceAttackSteps = groups.map((group, index) => {
    const template = structuredClone(baseArtifact.practiceAttackSteps[Math.min(index, baseArtifact.practiceAttackSteps.length - 1)]);
    const onsetBeat = group.timeMs / 1000;
    return {
      ...template,
      stepId: `${group.id}:step`,
      onsetBeat,
      renderNoteIds: group.pitches.map((pitch, pitchIndex) => `${group.id}:note:${pitch}:${pitchIndex}`),
      attackTargets: group.pitches.map((pitch, pitchIndex) => ({
        ...template.attackTargets[Math.min(pitchIndex, template.attackTargets.length - 1)],
        attackId: `${group.id}:attack:${pitch}:${pitchIndex}`,
        pitch,
        renderNoteIds: [`${group.id}:note:${pitch}:${pitchIndex}`],
        notes: [{
          eventId: `${group.id}:event`,
          measureNumbers: ['1'],
          pitch,
          renderNoteId: `${group.id}:note:${pitch}:${pitchIndex}`,
          staffIds: ['1'],
          stepNoteId: `${group.id}:step-note:${pitch}:${pitchIndex}`,
          voiceIds: ['1'],
        }],
      })),
    };
  });
  artifact.scoreEndBeat = Math.max(...groups.map((group) => (group.timeMs + (group.durationMs ?? 250)) / 1000), 0.25);
  return artifact;
}

function attack(id: string, pitch: string, performanceTimeMs: number): ObservedAttack {
  return {
    observationId: id,
    pitch,
    performanceTimeMs,
    confidence: 1,
    source: 'ACOUSTIC',
  };
}

function verdicts(evaluation: ContinuousEvaluationSession): readonly string[] {
  return evaluation.snapshot().strikes.map((strike) => strike.verdict);
}

describe('ContinuousEvaluationSession incremental finalization', () => {
  it('keeps a simple observation pending until analysis safely closes its assignment window', () => {
    const evaluation = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    evaluation.observeAttack(attack('o1', 'C4', 10));
    evaluation.advanceAnalysisThrough(249);

    expect(verdicts(evaluation)).toEqual(['PENDING']);

    evaluation.advanceAnalysisThrough(250);

    expect(evaluation.snapshot().strikes[0]).toMatchObject({
      verdict: 'MATCHED',
      matchedObservationId: 'o1',
      timingOffsetMs: 10,
    });
  });

  it('does not mark a strike missing before the full safe assignment opportunity closes', () => {
    const evaluation = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    evaluation.advanceAnalysisThrough(249);

    expect(verdicts(evaluation)).toEqual(['PENDING']);

    evaluation.advanceAnalysisThrough(250);

    expect(verdicts(evaluation)).toEqual(['MISSING']);
  });

  it('waits for the whole same-pitch conflict component before freezing overlapping assignments', () => {
    const evaluation = session([
      { id: 'a', timeMs: 0, pitches: ['C4'] },
      { id: 'b', timeMs: 200, pitches: ['C4'] },
    ]);
    evaluation.observeAttack(attack('o1', 'C4', 180));
    evaluation.advanceAnalysisThrough(250);

    expect(verdicts(evaluation)).toEqual(['PENDING', 'PENDING']);

    evaluation.observeAttack(attack('o2', 'C4', 300));
    evaluation.advanceAnalysisThrough(450);

    expect(evaluation.snapshot().strikes).toMatchObject([
      { verdict: 'MATCHED', matchedObservationId: 'o1', timingOffsetMs: 180 },
      { verdict: 'MATCHED', matchedObservationId: 'o2', timingOffsetMs: 100 },
    ]);
  });

  it('does not rematch finalized MATCHED or MISSING strikes from late evidence', () => {
    const matched = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    matched.observeAttack(attack('o1', 'C4', 10));
    matched.advanceAnalysisThrough(250);
    const finalizedMatched = matched.snapshot();

    expect(() => matched.observeAttack(attack('late', 'C4', 0))).toThrow(/behind the finalized analysis frontier/);
    expect(matched.snapshot()).toEqual(finalizedMatched);

    const missing = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    missing.advanceAnalysisThrough(250);
    const finalizedMissing = missing.snapshot();

    expect(() => missing.observeAttack(attack('late', 'C4', 0))).toThrow(/behind the finalized analysis frontier/);
    expect(missing.snapshot()).toEqual(finalizedMissing);
  });

  it('preserves one-to-one repeated same-pitch assignments inside a closed component', () => {
    const evaluation = session([
      { id: 'a', timeMs: 0, pitches: ['C4'] },
      { id: 'b', timeMs: 400, pitches: ['C4'] },
    ]);
    evaluation.publishObservations([
      attack('o1', 'C4', 10),
      attack('o2', 'C4', 410),
    ], 650);

    const strikes = evaluation.snapshot().strikes;
    expect(strikes).toMatchObject([
      { verdict: 'MATCHED', matchedObservationId: 'o1' },
      { verdict: 'MATCHED', matchedObservationId: 'o2' },
    ]);
    expect(new Set(strikes.map((strike) => strike.verdict === 'MATCHED' ? strike.matchedObservationId : null)).size).toBe(2);
  });

  it('does not finalize an unmatched observation as EXTRA while it can still join an open conflict component', () => {
    const evaluation = session([
      { id: 'a', timeMs: 0, pitches: ['C4'] },
      { id: 'b', timeMs: 200, pitches: ['C4'] },
    ]);
    evaluation.observeAttack(attack('o1', 'C4', 180));
    evaluation.advanceAnalysisThrough(250);

    expect(evaluation.snapshot().extras).toEqual([]);
  });

  it('finalizes extras only after no unfinalized expected strike can consume them', () => {
    const evaluation = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    evaluation.observeAttack(attack('extra-d4', 'D4', 90));
    evaluation.advanceAnalysisThrough(250);

    expect(evaluation.snapshot().extras).toEqual([attack('extra-d4', 'D4', 90)]);
    expect(() => evaluation.observeAttack(attack('late-d4', 'D4', 90))).toThrow(/behind the finalized analysis frontier/);
  });

  it('handles duplicate observation identities deterministically', () => {
    const evaluation = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    const first = attack('same-id', 'C4', 10);

    evaluation.observeAttack(first);
    evaluation.observeAttack({ ...first });
    expect(() => evaluation.observeAttack({ ...first, performanceTimeMs: 20 })).toThrow(/observationId already exists/);

    evaluation.advanceAnalysisThrough(250);
    expect(evaluation.snapshot().strikes[0]).toMatchObject({
      verdict: 'MATCHED',
      matchedObservationId: 'same-id',
    });
  });

  it('fails closed on backwards coverage and atomic late publications', () => {
    const evaluation = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    evaluation.advanceAnalysisThrough(250);
    const before = evaluation.snapshot();

    expect(() => evaluation.advanceAnalysisThrough(200)).toThrow(/monotonic/);
    expect(() => evaluation.publishObservations([attack('late', 'C4', 0)], 300))
      .toThrow(/behind the finalized analysis frontier/);
    expect(evaluation.snapshot()).toEqual(before);
  });

  it('keeps manual stop NOT_REACHED distinct while preserving already matched evidence', () => {
    const evaluation = session([
      { id: 'a', timeMs: 0, pitches: ['C4'] },
      { id: 'b', timeMs: 1000, pitches: ['D4'] },
    ]);
    evaluation.observeAttack(attack('o1', 'C4', 10));
    evaluation.advanceAnalysisThrough(250);
    evaluation.complete({
      reason: 'STOPPED_BY_USER',
      performanceTimeMs: 300,
      terminalPerformanceMs: 1250,
    });
    evaluation.advanceAnalysisThrough(300);

    expect(evaluation.snapshot().strikes).toMatchObject([
      { verdict: 'MATCHED', matchedObservationId: 'o1' },
      { verdict: 'NOT_REACHED' },
    ]);
  });

  it('uses the finalized live ledger as the completed evaluation truth', () => {
    const evaluation = session([{ id: 'a', timeMs: 0, pitches: ['C4'] }]);
    evaluation.publishObservations([attack('o1', 'C4', 10)], 250);
    const liveSnapshot = evaluation.snapshot();

    evaluation.complete({
      reason: 'SCOPE_COMPLETED',
      performanceTimeMs: 250,
      terminalPerformanceMs: 250,
    });

    expect(evaluation.completedEvaluation()).toEqual({
      status: 'COMPLETE',
      strikes: liveSnapshot.strikes.map((strike) => (
        strike.verdict === 'MATCHED'
          ? {
              strikeId: strike.strikeId,
              expectedGroupId: strike.groupId,
              pitch: strike.pitch,
              performanceTimeMs: strike.expectedPerformanceTimeMs,
              renderNoteIds: strike.renderNoteIds,
              result: 'MATCHED',
              matchedObservationId: strike.matchedObservationId,
              timingOffsetMs: strike.timingOffsetMs,
              confidence: 1,
              source: 'ACOUSTIC',
            }
          : {
              strikeId: strike.strikeId,
              expectedGroupId: strike.groupId,
              pitch: strike.pitch,
              performanceTimeMs: strike.expectedPerformanceTimeMs,
              renderNoteIds: strike.renderNoteIds,
              result: strike.verdict,
            }
      )),
      extras: [],
    });
  });
});
