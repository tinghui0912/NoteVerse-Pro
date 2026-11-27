import { describe, expect, it } from 'vitest';
import {
  canonicalContinuousCompletionInputFixture,
  completedContinuousSessionFixture,
} from '@/lib/practice/__fixtures__/continuous-result';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import {
  ContinuousEvaluationSession,
  unavailableContinuousEvaluation,
} from '@/lib/practice/continuous/domain/evaluation/session';
import { createContinuousPerformanceResult } from './continuous-performance-result';

function resultWithEvidence() {
  const base = canonicalContinuousCompletionInputFixture();
  const { plan, localSessionId } = base.session;
  const evaluator = new ContinuousEvaluationSession({
    artifact: plan.bundle.artifact,
    scope: plan.scope,
    inputSource: 'MIDI',
    sessionDomainId: localSessionId,
    timeline: { tickToTimeMs: (tick) => tick * 500 },
  });
  evaluator.publish({
    publicationId: 'evidence',
    sessionDomainId: localSessionId,
    analyzedThroughPerformanceMs: 10000,
    availabilitySessionTimeMs: 10000,
    observations: [
      {
        observationId: 'matched',
        pianoKey: 60,
        performanceTimeMs: 0,
        confidence: 1,
        source: 'MIDI',
        provenance: {
          sourceDomainId: 'capture',
          sourceSampleRateHz: 48000,
          sourceEventSample: 0,
        },
      },
      {
        observationId: 'extra',
        pianoKey: 76,
        performanceTimeMs: 6000,
        confidence: 1,
        source: 'MIDI',
      },
    ],
  });
  evaluator.complete({
    reason: 'SCOPE_COMPLETED',
    performanceTimeMs: 10000,
    availabilitySessionTimeMs: 10000,
  });
  return { session: base.session, evaluation: evaluator.completedEvaluation() };
}

describe('transient natural Continuous result', () => {
  it.each(['MIDI', 'MICROPHONE'] as const)(
    'retains exact executed owners for %s, including unavailable evaluation',
    (input) => {
      for (const available of [true, false]) {
        const original = canonicalContinuousCompletionInputFixture(
          input,
          available,
        );
        const result = createContinuousPerformanceResult(original);
        expect(result.executed.bundle).toBe(original.session.plan.bundle);
        expect(result.executed.scope).toBe(original.session.plan.scope);
        expect(result.executed.tempoPlan).toBe(original.session.plan.tempoPlan);
        expect(result.executed.bundle.binding).toBe(
          original.session.plan.bundle.binding,
        );
        expect(result.executed.bundle.artifact).toBe(
          original.session.plan.bundle.artifact,
        );
        expect(result.evaluation).toBe(original.evaluation);
        expect(result.activeElapsedMs).toBe(
          original.session.performance.activeElapsedMs,
        );
        expect(result.completedAtMs).toBe(original.session.updatedAtMs);
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.executed)).toBe(true);
        expect(Reflect.set(result.executed, 'scope', null)).toBe(false);
      }
    },
  );
  it('freezes only its owned projections without mutating caller session shells', () => {
    const original = canonicalContinuousCompletionInputFixture();
    const session = {
      ...original.session,
      performance: { ...original.session.performance },
    };
    const result = createContinuousPerformanceResult({
      session,
      evaluation: original.evaluation,
    });
    expect(Object.isFrozen(session)).toBe(false);
    expect(Object.isFrozen(session.performance)).toBe(false);
    expect(result.executed.bundle).toBe(session.plan.bundle);
    expect(result.executed.scope).toBe(session.plan.scope);
  });
  it.each(['STOPPED_BY_USER', null] as const)(
    'rejects completion reason %s',
    (completionReason) => {
      const base = canonicalContinuousCompletionInputFixture();
      expect(() =>
        createContinuousPerformanceResult({
          ...base,
          session: { ...base.session, completionReason },
        }),
      ).toThrow('naturally completed');
    },
  );
  it.each(['lifecycle', 'transport'] as const)(
    'rejects a non-ended %s',
    (kind) => {
      const base = canonicalContinuousCompletionInputFixture();
      const session =
        kind === 'lifecycle'
          ? { ...base.session, lifecycleState: 'ACTIVE' as const }
          : {
              ...base.session,
              performance: {
                ...base.session.performance,
                state: 'RUNNING' as const,
              },
            };
      expect(() =>
        createContinuousPerformanceResult({ ...base, session }),
      ).toThrow('ended session');
    },
  );
  it('rejects evaluation session identity mismatch', () => {
    const base = canonicalContinuousCompletionInputFixture();
    expect(() =>
      createContinuousPerformanceResult({
        ...base,
        session: { ...base.session, localSessionId: 'other' },
      }),
    ).toThrow('session identity');
  });
  it('rejects evaluation input mismatch', () => {
    const base = canonicalContinuousCompletionInputFixture();
    expect(() =>
      createContinuousPerformanceResult({
        session: base.session,
        evaluation: unavailableContinuousEvaluation(
          'MICROPHONE',
          'CONTINUOUS_ANALYSIS_UNAVAILABLE',
        ),
      }),
    ).toThrow();
  });
  it('rejects stopped evaluation even when its session claims natural completion', () => {
    const base = canonicalContinuousCompletionInputFixture();
    if (base.evaluation.status !== 'COMPLETE')
      throw new Error('Expected complete');
    const evaluation = {
      ...base.evaluation,
      assignment: {
        ...base.evaluation.assignment,
        completion: {
          ...base.evaluation.assignment.completion,
          reason: 'STOPPED_BY_USER' as const,
        },
      },
    };
    expect(() =>
      createContinuousPerformanceResult({ ...base, evaluation }),
    ).toThrow('natural scope completion');
  });
  it('requires exactly the canonical scoped attacks, including repeated and missing assignments', () => {
    const base = canonicalContinuousCompletionInputFixture();
    if (base.evaluation.status !== 'COMPLETE')
      throw new Error('Expected complete');
    const artifact = base.session.plan.bundle.artifact;
    const scope = {
      kind: 'RANGE' as const,
      startGroupId: artifact.moments[1].groupId,
      endGroupId: artifact.moments[1].groupId,
    };
    const plan = continuousPracticePlan(artifact, { scope });
    expect(() =>
      createContinuousPerformanceResult({
        session: completedContinuousSessionFixture(plan),
        evaluation: base.evaluation,
      }),
    ).toThrow('canonical scoped targets');
    const complete = base.evaluation;
    const assignment = complete.assignment;
    for (const groups of [
      assignment.groups.slice(1),
      [...assignment.groups, assignment.groups[0]],
    ]) {
      expect(() =>
        createContinuousPerformanceResult({
          ...base,
          evaluation: { ...complete, assignment: { ...assignment, groups } },
        }),
      ).toThrow();
    }
  });
  it('retains exact assignment observations and render identities without copying', () => {
    const base = resultWithEvidence();
    const result = createContinuousPerformanceResult(base);
    if (
      result.evaluation.status !== 'COMPLETE' ||
      base.evaluation.status !== 'COMPLETE'
    )
      throw new Error('Expected complete');
    expect(result.evaluation.assignment).toBe(base.evaluation.assignment);
    expect(result.evaluation.assignment.observations).toBe(
      base.evaluation.assignment.observations,
    );
    expect(
      result.evaluation.assignment.observations.map((o) => o.observationId),
    ).toEqual(['extra', 'matched']);
    expect(
      result.evaluation.assignment.groups[0].strikes[0].renderNoteIds,
    ).toBe(base.evaluation.assignment.groups[0].strikes[0].renderNoteIds);
  });
  it.each([
    'pitch',
    'offset',
    'window',
    'group onset',
    'confidence',
    'sample rate',
  ] as const)(
    'validates retained assignment %s semantics during construction',
    (corruption) => {
      const base = resultWithEvidence();
      if (base.evaluation.status !== 'COMPLETE')
        throw new Error('Expected complete');
      const original = base.evaluation.assignment;
      const matched = original.observations.find(
        (observation) => observation.observationId === 'matched',
      )!;
      const observation = {
        ...matched,
        ...(corruption === 'pitch' ? { pianoKey: 62 } : {}),
        ...(corruption === 'window' ? { performanceTimeMs: 251 } : {}),
        ...(corruption === 'confidence' ? { confidence: 1.1 } : {}),
        ...(corruption === 'sample rate'
          ? { provenance: { ...matched.provenance!, sourceSampleRateHz: 0 } }
          : {}),
      };
      const groups = original.groups.map((group, i) => ({
        ...group,
        ...(i === 0 && corruption === 'group onset'
          ? { performanceTimeMs: 1 }
          : {}),
        strikes: group.strikes.map((strike) =>
          strike.state === 'MATCHED'
            ? {
                ...strike,
                match: {
                  ...strike.match,
                  observation,
                  ...(corruption === 'offset' ? { timingOffsetMs: 1 } : {}),
                  ...(corruption === 'window' ? { timingOffsetMs: 251 } : {}),
                },
              }
            : strike,
        ),
      }));
      const evaluation = {
        ...base.evaluation,
        assignment: {
          ...original,
          groups,
          observations: original.observations.map((row) =>
            row.observationId === observation.observationId ? observation : row,
          ),
        },
      };
      expect(() =>
        createContinuousPerformanceResult({ ...base, evaluation }),
      ).toThrow();
    },
  );
});
