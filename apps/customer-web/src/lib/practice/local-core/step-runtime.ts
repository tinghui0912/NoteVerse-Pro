import {
  attackPitchesForStep,
  assertPracticeScoreArtifact,
  continuationPitchesForStep,
  groupForStep,
  resolvePracticeScope,
  type PracticeScoreArtifact,
  type PracticeScope,
} from './artifact';
import { pitchSetsEqual, type StepVerifierObservation, type StepVerifierTarget } from './evidence';
import type { LocalClock, RuntimeVersionIdentity } from './timebase';
import {
  createLocalSessionId,
  type LocalPracticeAttempt,
  type LocalStepSessionSnapshot,
} from './session';

export type StepRuntimeDecision =
  | { kind: 'WAIT'; reason: StepWaitReason; currentTarget: StepVerifierTarget | null }
  | { kind: 'MATCH'; reason: 'accepted_current_step'; advancedTo: StepVerifierTarget | null }
  | { kind: 'SKIP'; reason: 'user_skip'; advancedTo: StepVerifierTarget | null };

export type StepWaitReason =
  | 'no_observation'
  | 'scope_completed'
  | 'stale_step'
  | 'stale_activation'
  | 'wrong_or_partial_attack_set';

export type StepPracticeRuntimeOptions = {
  artifact: PracticeScoreArtifact;
  scope?: PracticeScope;
  inputSource?: 'MICROPHONE' | 'MIDI';
  localSessionId?: string;
  clock: LocalClock;
  version?: RuntimeVersionIdentity;
  snapshot?: LocalStepSessionSnapshot;
};

export class StepPracticeRuntime {
  readonly artifact: PracticeScoreArtifact;
  readonly localSessionId: string;

  private readonly scope = resolvePracticeScope;
  private readonly clock: LocalClock;
  private readonly resolvedScope;
  private currentIndex: number;
  private activationGeneration: number;
  private attempts: LocalPracticeAttempt[];
  private completed: boolean;
  private readonly version: RuntimeVersionIdentity;
  private readonly inputSource: 'MICROPHONE' | 'MIDI';

  constructor(options: StepPracticeRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.clock = options.clock;
    this.version = options.version ?? {
      schemaVersion: 1,
      runtimeVersion: 'local-practice-core-v1',
    };
    this.inputSource = options.inputSource ?? 'MICROPHONE';
    this.resolvedScope = this.scope(this.artifact, options.scope);
    this.localSessionId = options.snapshot?.localSessionId ?? options.localSessionId ?? createLocalSessionId();
    this.currentIndex = options.snapshot?.step.currentIndex ?? this.resolvedScope.startIndex;
    this.activationGeneration = options.snapshot?.step.activationGeneration ?? 1;
    this.attempts = [...(options.snapshot?.step.attempts ?? [])];
    this.completed = options.snapshot?.step.completed ?? false;
  }

  currentTarget(): StepVerifierTarget | null {
    const step = this.currentStep();
    if (!step || this.completed) {
      return null;
    }
    return {
      stepId: step.stepId,
      activationGeneration: this.activationGeneration,
      attackPitches: attackPitchesForStep(step),
      continuationPitches: continuationPitchesForStep(step),
    };
  }

  observe(observation?: StepVerifierObservation | null): StepRuntimeDecision {
    const target = this.currentTarget();
    if (!target) {
      return { kind: 'WAIT', reason: 'scope_completed', currentTarget: null };
    }
    if (!observation) {
      return { kind: 'WAIT', reason: 'no_observation', currentTarget: target };
    }
    if (observation.stepId !== target.stepId) {
      return { kind: 'WAIT', reason: 'stale_step', currentTarget: target };
    }
    if (observation.activationGeneration !== target.activationGeneration) {
      return { kind: 'WAIT', reason: 'stale_activation', currentTarget: target };
    }
    if (!pitchSetsEqual(observation.observedAttackPitches, target.attackPitches)) {
      return { kind: 'WAIT', reason: 'wrong_or_partial_attack_set', currentTarget: target };
    }

    this.recordAttempt({
      stepId: target.stepId,
      result: 'MATCH',
      observedAttackPitches: observation.observedAttackPitches,
      confidence: observation.confidence,
    });
    this.advanceOne();
    return {
      kind: 'MATCH',
      reason: 'accepted_current_step',
      advancedTo: this.currentTarget(),
    };
  }

  skip(): StepRuntimeDecision {
    const target = this.currentTarget();
    if (!target) {
      return { kind: 'WAIT', reason: 'scope_completed', currentTarget: null };
    }
    this.recordAttempt({
      stepId: target.stepId,
      result: 'SKIPPED',
      observedAttackPitches: [],
      confidence: 1,
    });
    this.advanceOne();
    return { kind: 'SKIP', reason: 'user_skip', advancedTo: this.currentTarget() };
  }

  reset(): void {
    this.currentIndex = this.resolvedScope.startIndex;
    this.completed = false;
    this.activationGeneration += 1;
  }

  snapshot(): LocalStepSessionSnapshot {
    const nowMs = this.clock.nowMs();
    return {
      localSessionId: this.localSessionId,
      scoreId: this.artifact.scoreId,
      revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId,
      mode: 'STEP_BY_STEP',
      inputSource: this.inputSource,
      practiceScope: {
        startGroupId: this.resolvedScope.startGroupId,
        endGroupId: this.resolvedScope.endGroupId,
      },
      lifecycleState: this.completed ? 'ENDED' : 'ACTIVE',
      version: this.version,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      step: {
        currentIndex: this.currentIndex,
        activationGeneration: this.activationGeneration,
        completed: this.completed,
        attempts: [...this.attempts],
      },
    };
  }

  get currentStepIndex(): number {
    return this.currentIndex;
  }

  get isCompleted(): boolean {
    return this.completed;
  }

  get attemptHistory(): LocalPracticeAttempt[] {
    return [...this.attempts];
  }

  private currentStep() {
    if (this.completed || this.currentIndex > this.resolvedScope.endIndex) {
      return null;
    }
    return this.artifact.practiceAttackSteps[this.currentIndex] ?? null;
  }

  private advanceOne(): void {
    this.currentIndex += 1;
    this.activationGeneration += 1;
    if (this.currentIndex > this.resolvedScope.endIndex) {
      this.completed = true;
    }
  }

  private recordAttempt(input: Omit<LocalPracticeAttempt, 'attemptId' | 'createdAtMs'>): void {
    this.attempts.push({
      attemptId: `${this.localSessionId}:attempt:${this.attempts.length + 1}`,
      createdAtMs: this.clock.nowMs(),
      ...input,
    });
  }
}

export function groupForCurrentStep(runtime: StepPracticeRuntime) {
  return groupForStep(runtime.artifact, runtime.currentStepIndex);
}
