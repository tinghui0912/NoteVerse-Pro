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
import type { DurableClock } from './timebase';
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
  | 'stale_attack'
  | 'wrong_or_partial_attack_set';

export type StepPracticeRuntimeOptions = {
  artifact: PracticeScoreArtifact;
  scope?: PracticeScope;
  inputSource?: 'MICROPHONE' | 'MIDI';
  localSessionId?: string;
  clock: LocalClock;
  metadataClock?: DurableClock;
  version?: RuntimeVersionIdentity;
  snapshot?: LocalStepSessionSnapshot;
};

export class StepPracticeRuntime {
  readonly artifact: PracticeScoreArtifact;
  readonly localSessionId: string;

  private readonly scope = resolvePracticeScope;
  private readonly clock: LocalClock;
  private readonly metadataClock: DurableClock;
  private readonly resolvedScope;
  private currentIndex: number;
  private activationGeneration: number;
  private activationBoundaryMs: number;
  private attempts: LocalPracticeAttempt[];
  private completed: boolean;
  private readonly version: RuntimeVersionIdentity;
  private readonly inputSource: 'MICROPHONE' | 'MIDI';
  private readonly createdAtMs: number;

  constructor(options: StepPracticeRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.clock = options.clock;
    this.metadataClock = options.metadataClock ?? { nowEpochMs: () => Date.now() };
    this.version = options.version ?? {
      schemaVersion: 1,
      runtimeVersion: 'local-practice-core-v1',
    };
    if (options.snapshot) {
      validateStepSnapshot(options.artifact, options.snapshot, options.inputSource, options.scope);
    }
    this.inputSource = options.snapshot?.inputSource ?? options.inputSource ?? 'MICROPHONE';
    this.resolvedScope = this.scope(this.artifact, options.snapshot?.practiceScope ?? options.scope);
    this.localSessionId = options.snapshot?.localSessionId ?? options.localSessionId ?? createLocalSessionId();
    this.createdAtMs = options.snapshot?.createdAtMs ?? this.metadataClock.nowEpochMs();
    this.currentIndex = options.snapshot?.step.currentIndex ?? this.resolvedScope.startIndex;
    this.activationGeneration = options.snapshot
      ? options.snapshot.step.activationGeneration + 1
      : 1;
    this.activationBoundaryMs = options.snapshot ? this.clock.nowMs() : -1;
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
      activationBoundaryMs: this.activationBoundaryMs,
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
    if (observation.attackOnsetTimeMs <= target.activationBoundaryMs) {
      return { kind: 'WAIT', reason: 'stale_attack', currentTarget: target };
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
    this.activationBoundaryMs = this.clock.nowMs();
  }

  snapshot(): LocalStepSessionSnapshot {
    const nowMs = this.metadataClock.nowEpochMs();
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
      createdAtMs: this.createdAtMs,
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
    this.activationBoundaryMs = this.clock.nowMs();
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

function validateStepSnapshot(
  artifact: PracticeScoreArtifact,
  snapshot: LocalStepSessionSnapshot,
  inputSource?: 'MICROPHONE' | 'MIDI',
  scope?: PracticeScope
): void {
  if (snapshot.mode !== 'STEP_BY_STEP') {
    throw new Error('Cannot restore non-STEP snapshot into StepPracticeRuntime.');
  }
  validateCommonSnapshot(artifact, snapshot, inputSource, scope);
  if (!Number.isInteger(snapshot.step.currentIndex) || snapshot.step.currentIndex < 0) {
    throw new Error('Invalid STEP snapshot current index.');
  }
  if (snapshot.step.currentIndex > artifact.practiceAttackSteps.length) {
    throw new Error('STEP snapshot current index is outside the artifact.');
  }
  if (!Number.isInteger(snapshot.step.activationGeneration) || snapshot.step.activationGeneration < 1) {
    throw new Error('Invalid STEP snapshot activation generation.');
  }
}

function validateCommonSnapshot(
  artifact: PracticeScoreArtifact,
  snapshot: LocalStepSessionSnapshot,
  inputSource?: 'MICROPHONE' | 'MIDI',
  scope?: PracticeScope
): void {
  if (snapshot.scoreId !== artifact.scoreId
    || snapshot.revisionId !== artifact.revisionId
    || snapshot.artifactId !== artifact.artifactId) {
    throw new Error('Practice session snapshot does not belong to this score artifact.');
  }
  if (snapshot.version.schemaVersion !== 1 || snapshot.version.runtimeVersion !== 'local-practice-core-v1') {
    throw new Error('Unsupported local practice runtime snapshot version.');
  }
  if (inputSource && snapshot.inputSource !== inputSource) {
    throw new Error('Practice session snapshot input source mismatch.');
  }
  if (scope && JSON.stringify(scope) !== JSON.stringify(snapshot.practiceScope ?? {})) {
    throw new Error('Practice session snapshot scope mismatch.');
  }
}
