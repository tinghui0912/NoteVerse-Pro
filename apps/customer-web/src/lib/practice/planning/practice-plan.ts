import type { PracticeBundleBinding } from '@/lib/practice/bundle/admitted-practice-bundle';
import {
  resolveMetronomePlan,
  type ResolvedMetronomePlan,
} from '@/lib/practice/metronome/metronome-plan';
import {
  planPracticeResources,
  type PracticeResourcePlan,
} from './resource-plan';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';
import { resolvePracticeScope, type ResolvedPracticeScope } from './scope';
import {
  resolvePracticeTempoPlan,
  type ResolvedPracticeTempoPlan,
} from './tempo';
import { countInContractAt, type CountInContract } from './count-in';
import type { PracticeIntent } from './intent';

export type PracticePlanBundle = Readonly<{
  binding: PracticeBundleBinding;
  artifact: PracticeScoreArtifact;
}>;
type PlannedTruth = Readonly<{
  bundle: PracticePlanBundle;
  resources: PracticeResourcePlan;
  scope: Readonly<ResolvedPracticeScope>;
  tempoPlan: ResolvedPracticeTempoPlan;
  metronomePlan: ResolvedMetronomePlan;
}>;
export type PracticePlan = PlannedTruth &
  (
    | Readonly<{ mode: 'STEP_BY_STEP' }>
    | Readonly<{ mode: 'CONTINUOUS_PLAY'; countIn: Readonly<CountInContract> }>
  );
export type StepPracticePlan = Extract<PracticePlan, { mode: 'STEP_BY_STEP' }>;
export type ContinuousPracticePlan = Extract<
  PracticePlan,
  { mode: 'CONTINUOUS_PLAY' }
>;

export function planPractice(
  bundle: PracticePlanBundle,
  intent: Extract<PracticeIntent, { mode: 'STEP_BY_STEP' }>,
): StepPracticePlan;
export function planPractice(
  bundle: PracticePlanBundle,
  intent: Extract<PracticeIntent, { mode: 'CONTINUOUS_PLAY' }>,
): ContinuousPracticePlan;
export function planPractice(
  bundle: PracticePlanBundle,
  intent: PracticeIntent,
): PracticePlan;
/** Pure Start-time resolution; no browser resources, clocks, or retained planning state. */
export function planPractice(
  bundle: PracticePlanBundle,
  intent: PracticeIntent,
): PracticePlan {
  if (typeof bundle.binding.bundleId !== 'string' || !bundle.binding.bundleId)
    throw new Error('Practice bundle identity required.');
  const resources = planPracticeResources(intent);
  if (
    typeof intent.metronomeEnabled !== 'boolean' ||
    !intent.scope ||
    !['FULL', 'RANGE'].includes(intent.scope.kind) ||
    !intent.tempoSelection ||
    !['SCORE', 'CUSTOM_FIXED_BPM'].includes(intent.tempoSelection.mode)
  ) {
    throw new Error('Invalid Practice intent.');
  }
  const scope = Object.freeze(
    resolvePracticeScope(bundle.artifact, intent.scope),
  );
  const tempoPlan = freezeValue(
    resolvePracticeTempoPlan(bundle.artifact, { ...intent.tempoSelection }),
  );
  const truth = {
    bundle: Object.freeze({
      binding: bundle.binding,
      artifact: bundle.artifact,
    }),
    resources,
    scope,
    tempoPlan,
    metronomePlan: resolveMetronomePlan({
      mode: intent.mode === 'STEP_BY_STEP' ? 'STEP' : 'CONTINUOUS',
      ticksPerQuarter: bundle.artifact.ticksPerQuarter,
      meterSegments: bundle.artifact.meterSegments,
      tempoPlan,
      timelineEndTick: bundle.artifact.scoreEndTick,
      scopeStartTick: scope.startTick,
      scopeEndTick: scope.terminalTick,
      initiallyEnabled: intent.metronomeEnabled,
    }),
  };
  return Object.freeze(
    intent.mode === 'STEP_BY_STEP'
      ? { ...truth, mode: 'STEP_BY_STEP' as const }
      : {
          ...truth,
          mode: 'CONTINUOUS_PLAY' as const,
          countIn: Object.freeze(
            countInContractAt(bundle.artifact, scope.startTick),
          ),
        },
  );
}
function freezeValue<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}
