import { vi } from 'vitest';
import type { StepPracticeController, StepControllerOptions } from '../step/step-practice-controller';
import type { ContinuousPracticeController, ContinuousControllerOptions } from '../continuous/continuous-practice-controller';
import { canonicalContinuousResultFixture } from './continuous-result';

export function stepSessionController(options: StepControllerOptions) {
  const state = { error: null as string | null };
  const controller = {
    start: vi.fn(async () => {}), abandon: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}), skip: vi.fn(), setMetronomeEnabled: vi.fn(),
    snapshot: vi.fn(() => ({ error: state.error, activeStepGroup: options.plan.bundle.artifact.moments[0],
      stepInteractionPhase: 'READY', pendingPostVerdict: null, canAcceptAttempt: true,
      analysisIntervention: null, infrastructureIntervention: null } as ReturnType<StepPracticeController['snapshot']>)),
  };
  return { controller, state, complete: () => options.onNaturalCompletion?.({ completionReason: 'SCOPE_COMPLETED', localSessionId: 'step-fixture' } as never) };
}

export function continuousSessionController(options: ContinuousControllerOptions) {
  const completion = { result: canonicalContinuousResultFixture(), recording: { status: 'NOT_RECORDED' as const } };
  const state = { session: 'ACTIVE', inputError: null as string | null, completed: false };
  const controller = {
    start: vi.fn(async () => {}), abandon: vi.fn(async () => {}), dispose: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}), pause: vi.fn(), resume: vi.fn(), setMetronomeEnabled: vi.fn(),
    continueWithoutAnalysis: vi.fn(async () => {}), continueWithoutRecording: vi.fn(), continueAfterRecovery: vi.fn(() => true),
    snapshot: vi.fn(() => ({ session: state.session, inputError: state.inputError,
      transport: { state: 'RUNNING', performanceTimeMs: 5 }, evaluation: null,
      recording: { indicatorVisible: true, elapsedMs: 2500 }, analysisIntervention: null,
      resourceIntervention: null, completed: state.completed ? completion : null } as ReturnType<ContinuousPracticeController['snapshot']>)),
  };
  return { controller, state, completion, complete: () => {
    state.completed = true; state.session = 'COMPLETE';
    options.onNaturalCompletion?.({ completionReason: 'SCOPE_COMPLETED', localSessionId: 'continuous-fixture' } as never);
  } };
}
