import type { ContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { CONTINUOUS_PERFORMANCE_RESULT_SCHEMA_VERSION } from '@/lib/practice/result/continuous-performance-result';
import { createContinuousPerformanceMetrics } from '@/lib/practice/result/continuous-performance-metrics';
import { microphoneEvidenceProvenance, midiEvidenceProvenance } from '@/lib/practice/result/continuous-result-provenance';
import { CONTINUOUS_MIDI_EVIDENCE_POLICY_ID } from '@/lib/practice/continuous/input/midi-evidence-identity';

export function continuousResultFixture(fields: Omit<ContinuousPerformanceResult, 'schemaVersion' | 'metrics' | 'evidenceProvenance'>): ContinuousPerformanceResult {
  const evaluation = fields.evaluation.status === 'COMPLETE' ? { ...fields.evaluation,
    assignment: { ...fields.evaluation.assignment, sessionDomainId: fields.localSessionId } } : fields.evaluation;
  const targetStrikeCount = evaluation.status === 'COMPLETE' ? evaluation.interpretation.groups.flatMap(group => group.strikes as readonly { strikeId: string }[]).length : 0;
  return { ...fields, schemaVersion: CONTINUOUS_PERFORMANCE_RESULT_SCHEMA_VERSION, evaluation,
    metrics: createContinuousPerformanceMetrics(evaluation, targetStrikeCount),
    evidenceProvenance: fields.inputSource === 'MIDI' ? midiEvidenceProvenance(CONTINUOUS_MIDI_EVIDENCE_POLICY_ID) : microphoneEvidenceProvenance(48000) };
}

import artifactJson from './canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { ContinuousEvaluationSession, unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import { createContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { resolvePracticeTempoPlan } from '@/lib/practice/kernel/tempo';

export function canonicalContinuousResultFixture(inputSource: 'MIDI' | 'MICROPHONE' = 'MIDI', rate: 44100 | 48000 = 48000, available = true): ContinuousPerformanceResult {
  const artifact = artifactJson as PracticeScoreArtifact, scope = { kind: 'FULL' } as const, localSessionId = 'result-fixture';
  const session = new ContinuousEvaluationSession({ artifact, scope, inputSource, sessionDomainId: localSessionId,
    timeline: { beatToTimeMs: beat => beat * 500 } });
  session.publish({ publicationId: 'coverage', sessionDomainId: localSessionId, analyzedThroughPerformanceMs: 10000, availabilityTimeMs: 10000, observations: [] });
  session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilityTimeMs: 10000 });
  return createContinuousPerformanceResult({ artifact, scope, localSessionId, inputSource, activeElapsedMs: 10000,
    tempoPlan: resolvePracticeTempoPlan(artifact, { mode: 'SCORE' }),
    evaluation: available ? session.completedEvaluation() : unavailableContinuousEvaluation(inputSource, 'CONTINUOUS_ANALYSIS_UNAVAILABLE'),
    evidenceProvenance: inputSource === 'MIDI' ? midiEvidenceProvenance(CONTINUOUS_MIDI_EVIDENCE_POLICY_ID) : microphoneEvidenceProvenance(rate),
    completedAt: '2026-10-26T00:00:00.000Z' });
}
