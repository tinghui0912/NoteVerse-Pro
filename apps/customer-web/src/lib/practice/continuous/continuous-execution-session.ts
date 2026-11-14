import { ContinuousPracticeController, type ContinuousControllerOptions } from './continuous-practice-controller';
import { browserContinuousPlatform } from './continuous-platform';
import { projectContinuousFailure } from './continuous-errors';
import { isPracticeCausalFailure } from '@/lib/practice/failure/causal-failure';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';
import { borrowExecutionRoots, type ExecutionSessionRequest, type ExecutionSessionConstruction,
  type ExecutionFailurePhase, type PracticeExecutionSession } from '@/lib/practice/application/execution-session';
import type { ExecutionFailure, ExecutionObservation } from '@/lib/practice/application/execution-observation';
import type { ContinuousPracticePlan } from '@/lib/practice/planning/practice-plan';

type Controller = Pick<ContinuousPracticeController, 'start' | 'abandon' | 'dispose' | 'snapshot' | 'subscribe' |
  'pause' | 'resume' | 'setMetronomeEnabled' | 'continueWithoutAnalysis' | 'continueWithoutRecording' | 'continueAfterRecovery'>;
export type ContinuousExecutionRequest = ExecutionSessionRequest & Readonly<{ plan: ContinuousPracticePlan }>;
type CreateController = (options: ContinuousControllerOptions) => Controller;

function failure(cause: unknown, phase: ExecutionFailurePhase): ExecutionFailure {
  return { mode: 'CONTINUOUS_PLAY', cause, code: phase === 'RELEASE' ? 'RESOURCE_CLEANUP_FAILED'
    : isPracticeCausalFailure(cause) ? projectContinuousFailure(cause, 'PREPARING') : 'ANALYSIS_FAILED' };
}

export function createContinuousExecutionSession(request: ContinuousExecutionRequest,
  create: CreateController = options => new ContinuousPracticeController(options, browserContinuousPlatform(request.ports.acquireInference)),
): ExecutionSessionConstruction {
  try {
    const controller = create({ plan: request.plan, devices: borrowExecutionRoots(request.plan, request.ports),
      rootHealth: request.ports.rootHealth, startupTimings: new PracticeStartupTimings(),
      onNaturalCompletion: request.onNaturalCompletion });
    const session: PracticeExecutionSession = {
      mode: 'CONTINUOUS_PLAY',
      commands: Object.freeze({ mode: 'CONTINUOUS_PLAY',
        pause: () => { if (request.isCommandAccepted()) controller.pause(); },
        resume: () => { if (request.isCommandAccepted()) controller.resume(); },
        setMetronomeEnabled: (enabled: boolean) => { if (request.isCommandAccepted()) controller.setMetronomeEnabled(enabled); },
        continueWithoutAnalysis: () => request.isCommandAccepted() ? controller.continueWithoutAnalysis() : Promise.resolve(),
        continueWithoutRecording: () => { if (request.isCommandAccepted()) controller.continueWithoutRecording(); },
        continueAfterRecovery: () => request.isCommandAccepted() && controller.continueAfterRecovery(),
      }),
      subscribe: listener => controller.subscribe(listener),
      observe: (): ExecutionObservation => {
        const snapshot = controller.snapshot();
        return Object.freeze({ mode: 'CONTINUOUS_PLAY', error: snapshot.inputError,
          phase: snapshot.session === 'FINALIZING' ? 'FINALIZING'
            : ['FAILED', 'FAILED_BEFORE_START'].includes(snapshot.session) ? 'ERROR'
              : snapshot.session === 'PREPARING' ? 'PREPARING'
                : snapshot.transport?.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE',
          transport: snapshot.transport, evaluation: snapshot.evaluation,
          recordingIndicator: snapshot.recording?.indicatorVisible ? Math.floor(snapshot.recording.elapsedMs / 1000) : null,
          analysisIntervention: snapshot.analysisIntervention, resourceIntervention: snapshot.resourceIntervention,
          completion: snapshot.completed });
      },
      start: () => controller.start(),
      retire: async () => { await controller.abandon(); assertReleased(); },
      dispose: async () => { await controller.dispose(); assertReleased(); },
      failure,
    };
    function assertReleased() {
      if (controller.snapshot().inputError === 'RESOURCE_CLEANUP_FAILED') throw new Error('RESOURCE_CLEANUP_FAILED');
    }
    return { status: 'READY', session };
  } catch (cause) { return { status: 'FAILED', failure: failure(cause, 'START') }; }
}
