import type { PracticePlan } from '@/lib/practice/planning/practice-plan';
import type { PracticeDeviceRoots, PracticeRootHealthPort } from '@/lib/practice/device/device-contract';
import type { AcousticInferencePort } from '@/lib/practice/acoustic/runtime/inference-types';
import { DeviceFailure, MidiFailure } from '@/lib/practice/failure/causal-failure';
import type { StepExecutionCommands } from '@/lib/practice/step/execution-commands';
import type { ContinuousExecutionCommands } from '@/lib/practice/continuous/execution-commands';
import type { ExecutionCompletion, ExecutionFailure, ExecutionObservation } from './execution-observation';

export type PracticeExecutionPorts = Readonly<{
  borrowRoots(): PracticeDeviceRoots | null;
  rootHealth: PracticeRootHealthPort;
  acquireInference?: (signal: AbortSignal) => Promise<AcousticInferencePort>;
}>;
export type ModeExecutionCommands = StepExecutionCommands | ContinuousExecutionCommands;
export type ExecutionFailurePhase = 'START' | 'RELEASE';
export type ExecutionSessionRequest = Readonly<{
  plan: PracticePlan;
  ports: PracticeExecutionPorts;
  isCommandAccepted(): boolean;
  onNaturalCompletion(session: ExecutionCompletion): void;
}>;

/** Leaf effect capability. Command admission is supplied by the root execution owner. */
export interface PracticeExecutionSession {
  readonly mode: PracticePlan['mode'];
  readonly commands: ModeExecutionCommands;
  subscribe(listener: () => void): () => void;
  observe(): ExecutionObservation;
  start(): Promise<void>;
  retire(): Promise<void>;
  dispose(): Promise<void>;
  failure(cause: unknown, phase: ExecutionFailurePhase): ExecutionFailure;
}
export type ExecutionSessionConstruction =
  | Readonly<{ status: 'READY'; session: PracticeExecutionSession }>
  | Readonly<{ status: 'FAILED'; failure: ExecutionFailure }>;
export type PracticeExecutionSessionFactory = (request: ExecutionSessionRequest) => ExecutionSessionConstruction;

/** Only borrows retained roots; availability never grants acquisition or release authority. */
export function borrowExecutionRoots(plan: PracticePlan, ports: PracticeExecutionPorts): PracticeDeviceRoots {
  const devices = ports.borrowRoots();
  if (!devices) throw plan.resources.input.kind === 'MIDI'
    ? new MidiFailure('ACCESS_UNAVAILABLE') : new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
  return devices;
}
