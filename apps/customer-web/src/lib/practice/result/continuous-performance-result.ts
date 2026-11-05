import { assertCompletedEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import type { ResolvedPracticeScope } from '@/lib/practice/planning/scope';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/planning/tempo';
import { assertContinuousEvidenceProvenance, type ContinuousEvidenceProvenance } from './continuous-result-provenance';

export const CONTINUOUS_PERFORMANCE_RESULT_SCHEMA_VERSION = 8;
export type ContinuousPerformanceResult = Readonly<{
  schemaVersion: typeof CONTINUOUS_PERFORMANCE_RESULT_SCHEMA_VERSION;
  sourceId: string; localSessionId: string; scoreId: string; revisionId: string; artifactId: string;
  scope: Readonly<ResolvedPracticeScope>; tempoPlan: ResolvedPracticeTempoPlan;
  inputSource: PracticeInputSource; activeElapsedMs: number;
  evaluation: CompletedContinuousEvaluation;
  evidenceProvenance: ContinuousEvidenceProvenance; completedAt: string;
}>;

type ResultCreation = Readonly<{
  sourceId: string; localSessionId: string; artifact: PracticeScoreArtifact; scope: Readonly<ResolvedPracticeScope>; tempoPlan: ResolvedPracticeTempoPlan;
  inputSource: PracticeInputSource; activeElapsedMs: number; evaluation: CompletedContinuousEvaluation;
  evidenceProvenance: ContinuousEvidenceProvenance; completedAt: string;
}>;
export function createContinuousPerformanceResult(options: ResultCreation): ContinuousPerformanceResult {
  const scope = options.scope;
  const expected = options.artifact.moments.slice(scope.startIndex, scope.endIndex + 1).flatMap(group => group.attacks);
  if (options.evaluation.status === 'COMPLETE') {
    assertNaturalResultCompletion(options.evaluation);
    const assigned = options.evaluation.assignment.groups.flatMap(group => group.strikes);
    const ids = new Set(assigned.map(strike => strike.strikeId));
    if (assigned.length !== expected.length || expected.some(strike => !ids.has(strike.attackId))) {
      throw new Error('Continuous result does not cover its canonical scoped targets.');
    }
  }
  const value: ContinuousPerformanceResult = {
    schemaVersion: CONTINUOUS_PERFORMANCE_RESULT_SCHEMA_VERSION, sourceId: options.sourceId, localSessionId: options.localSessionId,
    scoreId: options.artifact.scoreId, revisionId: options.artifact.revisionId, artifactId: options.artifact.artifactId,
    scope, tempoPlan: options.tempoPlan, inputSource: options.inputSource, activeElapsedMs: options.activeElapsedMs,
    evaluation: options.evaluation,
    evidenceProvenance: options.evidenceProvenance, completedAt: options.completedAt,
  };
  assertContinuousPerformanceResult(value);
  return immutableContinuousValue(structuredClone(value));
}

/** Also accepts parsed JSON: validation never upgrades or repairs an artifact. */
export function assertContinuousPerformanceResult(value: unknown): asserts value is ContinuousPerformanceResult {
  assertJsonValue(value);
  const result = value as ContinuousPerformanceResult;
  const keys = ['schemaVersion', 'sourceId', 'localSessionId', 'scoreId', 'revisionId', 'artifactId', 'scope', 'tempoPlan', 'inputSource',
    'activeElapsedMs', 'evaluation', 'evidenceProvenance', 'completedAt'];
  if (!result || Object.keys(result).sort().join() !== keys.sort().join() || result.schemaVersion !== CONTINUOUS_PERFORMANCE_RESULT_SCHEMA_VERSION
    || !['MIDI', 'MICROPHONE'].includes(result.inputSource)
    || ![result.sourceId, result.localSessionId, result.scoreId, result.revisionId, result.artifactId].every(id => typeof id === 'string' && id.length > 0)
    || !Number.isFinite(result.activeElapsedMs) || result.activeElapsedMs < 0
    || typeof result.completedAt !== 'string' || !Number.isFinite(Date.parse(result.completedAt))
    || new Date(result.completedAt).toISOString() !== result.completedAt) throw new Error('Continuous result identity is invalid.');
  const scope = result.scope;
  if (!scope || !['FULL', 'RANGE'].includes(scope.kind) || !Number.isSafeInteger(scope.startIndex) || scope.startIndex < 0
    || !Number.isSafeInteger(scope.endIndex) || scope.endIndex < scope.startIndex
    || !Number.isSafeInteger(scope.startTick) || scope.startTick < 0 || !Number.isSafeInteger(scope.terminalTick) || scope.terminalTick < scope.startTick
    || scope.kind === 'RANGE' && (!scope.startGroupId || !scope.endGroupId)) throw new Error('Continuous result scope is invalid.');
  const plan = result.tempoPlan;
  if (!plan || !['SCORE', 'CUSTOM_FIXED_BPM'].includes(plan.selection?.mode)
    || plan.selection.mode === 'CUSTOM_FIXED_BPM' && (!Number.isFinite(plan.selection.bpm) || plan.selection.bpm <= 0)
    || !Array.isArray(plan.segments) || !plan.segments.length || plan.segments[0].startTick !== 0
    || plan.segments.some((segment, index) => !Number.isSafeInteger(segment.startTick) || segment.startTick < 0
      || !Number.isFinite(segment.bpm) || segment.bpm <= 0 || !['MUSICXML', 'PRODUCT_DEFAULT', 'CUSTOM'].includes(segment.source)
      || index > 0 && segment.startTick <= plan.segments[index - 1].startTick)) throw new Error('Continuous result tempo is invalid.');
  assertCompletedEvaluation(result.evaluation, result.inputSource);
  assertNaturalResultCompletion(result.evaluation);
  if (result.evaluation.status === 'COMPLETE' && result.evaluation.assignment.sessionDomainId !== result.localSessionId) {
    throw new Error('Continuous result session identity is inconsistent.');
  }
  assertContinuousEvidenceProvenance(result.evidenceProvenance);
  if (result.evidenceProvenance.inputSource !== result.inputSource) throw new Error('Continuous evidence source identity is inconsistent.');
}
function assertNaturalResultCompletion(evaluation: CompletedContinuousEvaluation): void {
  if (evaluation.status === 'COMPLETE' && evaluation.assignment.completion.reason !== 'SCOPE_COMPLETED') {
    throw new Error('Continuous result requires natural scope completion.');
  }
}
function assertJsonValue(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || ancestors.has(value)
    || !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Continuous result must contain only JSON values.');
  ancestors.add(value);
  for (const child of Object.values(value)) assertJsonValue(child, ancestors);
  ancestors.delete(value);
}
