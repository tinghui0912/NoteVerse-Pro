import { resolveMetronomePlan, type ResolvedMetronomePlan } from '@/lib/practice/metronome/metronome-plan';
import { planPracticeResources, type PracticeResourcePlan } from './resource-plan';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { resolvePracticeScope, type ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import { resolvePracticeTempoPlan, type ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import type { PracticeExecutionIntent } from './execution-intent';

type PlannedTruth = Readonly<{
  resources: PracticeResourcePlan;
  sourceId: string;
  artifact: PracticeScoreArtifact;
  inputSource: PracticeExecutionIntent['inputSource'];
  scope: Readonly<ResolvedPracticeScope>;
  tempoPlan: ResolvedPracticeTempoPlan;
  metronomePlan: ResolvedMetronomePlan;
}>;
export type PracticeSessionPlan = PlannedTruth & (
  | Readonly<{ mode: 'STEP_BY_STEP'; recordingMode: 'OFF' }>
  | Readonly<{ mode: 'CONTINUOUS_PLAY'; recordingMode: 'OFF' | 'AUDIO' | 'VIDEO' }>
);
export type StepPracticeSessionPlan = Extract<PracticeSessionPlan, { mode: 'STEP_BY_STEP' }>;
export type ContinuousPracticeSessionPlan = Extract<PracticeSessionPlan, { mode: 'CONTINUOUS_PLAY' }>;

/** A composition-local planner retains only its current semantic resolution.
 * Initial metronome changes reuse that resolution; browser resources and runtime state are external.
 */
export function createPracticeSessionPlanner() {
  let current: { key: string; artifact: PracticeScoreArtifact;
    scope: Readonly<ResolvedPracticeScope>; tempoPlan: ResolvedPracticeTempoPlan } | null = null;
  return function planPracticeSession(
    source: Readonly<{ sourceId: string; artifact: PracticeScoreArtifact }>,
    intent: PracticeExecutionIntent,
  ): PracticeSessionPlan {
    if (typeof source.sourceId !== 'string' || !source.sourceId) throw new Error('Practice source identity required.');
    const resources = planPracticeResources(intent);
    if (typeof intent.metronomeEnabled !== 'boolean'
      || !intent.scope || !['FULL', 'RANGE'].includes(intent.scope.kind)
      || !intent.tempoSelection || !['SCORE', 'CUSTOM_FIXED_BPM'].includes(intent.tempoSelection.mode)) {
      throw new Error('Invalid Practice execution intent.');
    }
    const key = JSON.stringify([source.sourceId, intent.mode, intent.inputSource, intent.recordingMode,
      intent.scope, intent.tempoSelection]);
    if (!current || current.key !== key || current.artifact !== source.artifact) {
      const scope = Object.freeze(resolvePracticeScope(source.artifact, intent.scope));
      const tempoPlan = freezeValue(resolvePracticeTempoPlan(source.artifact, { ...intent.tempoSelection }));
      current = { key, artifact: freezeValue(source.artifact), scope, tempoPlan };
    }
    const truth = { resources, sourceId: source.sourceId, artifact: current.artifact, inputSource: intent.inputSource,
      scope: current.scope, tempoPlan: current.tempoPlan, metronomePlan: resolveMetronomePlan({ mode: intent.mode === 'STEP_BY_STEP' ? 'STEP' : 'CONTINUOUS',
        meterSegments: current.artifact.meterSegments, tempoPlan: current.tempoPlan, timelineEndBeat: current.artifact.scoreEndBeat,
        scopeStartBeat: current.scope.startBeat, scopeEndBeat: current.scope.terminalBeat, initiallyEnabled: intent.metronomeEnabled }) };
    return intent.mode === 'STEP_BY_STEP'
      ? Object.freeze({ ...truth, mode: 'STEP_BY_STEP', recordingMode: 'OFF' })
      : Object.freeze({ ...truth, mode: 'CONTINUOUS_PLAY', recordingMode: intent.recordingMode });
  };
}

function freezeValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}
