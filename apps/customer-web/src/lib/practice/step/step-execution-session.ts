import { StepPracticeController, type StepControllerOptions } from './step-practice-controller';
import { browserStepPlatform } from './step-platform';
import { projectStepFailure } from './step-errors';
import { isPracticeCausalFailure } from '@/lib/practice/failure/causal-failure';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import { borrowExecutionRoots, type ExecutionSessionRequest, type ExecutionSessionConstruction,
  type ExecutionFailurePhase, type PracticeExecutionSession } from '@/lib/practice/application/execution-session';
import type { ExecutionFailure, ExecutionObservation } from '@/lib/practice/application/execution-observation';
import type { StepPracticePlan } from '@/lib/practice/planning/practice-plan';

type Controller = Pick<StepPracticeController, 'start' | 'abandon' | 'dispose' | 'snapshot' | 'subscribe' | 'skip' | 'setMetronomeEnabled'>;
export type StepExecutionRequest = ExecutionSessionRequest & Readonly<{ plan: StepPracticePlan }>;
type CreateController = (options: StepControllerOptions) => Controller;

function failure(cause: unknown, phase: ExecutionFailurePhase): ExecutionFailure {
  return { mode: 'STEP_BY_STEP', cause, code: phase === 'RELEASE' ? 'STEP_RESOURCE_CLEANUP_FAILED'
    : isPracticeCausalFailure(cause) ? projectStepFailure(cause, 'PREPARING') : 'STEP_ATTEMPT_FAILED' };
}

export function createStepExecutionSession(request: StepExecutionRequest,
  create: CreateController = options => new StepPracticeController({ ...options, platform: browserStepPlatform(request.ports.acquireInference) }),
): ExecutionSessionConstruction {
  try {
    const controller = create({ plan: request.plan, devices: borrowExecutionRoots(request.plan, request.ports),
      rootHealth: request.ports.rootHealth, startupTimings: new PracticeStartupTimings(),
      onNaturalCompletion: request.onNaturalCompletion });
    const session: PracticeExecutionSession = {
      mode: 'STEP_BY_STEP',
      commands: Object.freeze({ mode: 'STEP_BY_STEP',
        skip: () => { if (request.isCommandAccepted()) controller.skip(); },
        setMetronomeEnabled: (enabled: boolean) => { if (request.isCommandAccepted()) controller.setMetronomeEnabled(enabled); },
      }),
      subscribe: listener => controller.subscribe(listener),
      observe: (): ExecutionObservation => {
        const snapshot = controller.snapshot();
        return Object.freeze({ mode: 'STEP_BY_STEP', error: snapshot.error,
          activeStepGroup: snapshot.activeStepGroup, stepInteractionPhase: snapshot.stepInteractionPhase,
          pendingPostVerdict: snapshot.pendingPostVerdict, canAcceptAttempt: snapshot.canAcceptAttempt,
          analysisIntervention: snapshot.analysisIntervention, infrastructureIntervention: snapshot.infrastructureIntervention });
      },
      start: () => controller.start(),
      retire: async () => { await controller.abandon(); assertReleased(); },
      dispose: async () => { await controller.dispose(); assertReleased(); },
      failure,
    };
    function assertReleased() {
      if (controller.snapshot().error === 'STEP_RESOURCE_CLEANUP_FAILED') throw new Error('STEP_RESOURCE_CLEANUP_FAILED');
    }
    return { status: 'READY', session };
  } catch (cause) { return { status: 'FAILED', failure: failure(cause, 'START') }; }
}
