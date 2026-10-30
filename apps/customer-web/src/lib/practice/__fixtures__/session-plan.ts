import type { PracticeScoreArtifact } from '../kernel/artifact';
import type { PracticeExecutionIntent } from '../planning/execution-intent';
import { createPracticeSessionPlanner, type StepPracticeSessionPlan, type ContinuousPracticeSessionPlan } from '../planning/session-plan';

type Choices = Partial<Omit<PracticeExecutionIntent, 'mode'>>;
export function stepSessionPlan(artifact: PracticeScoreArtifact, choices: Choices = {}): StepPracticeSessionPlan {
  return createPracticeSessionPlanner()({ sourceId: 'practice-source-fixture', artifact }, {
    mode: 'STEP_BY_STEP', recordingMode: 'OFF', inputSource: 'MIDI', scope: { kind: 'FULL' },
    tempoSelection: { mode: 'SCORE' }, metronomeEnabled: false, ...choices,
  } as Extract<PracticeExecutionIntent, { mode: 'STEP_BY_STEP' }>) as StepPracticeSessionPlan;
}
export function continuousSessionPlan<const T extends Choices = {}>(artifact: PracticeScoreArtifact, choices: T = {} as T): ContinuousPracticeSessionPlan & { inputSource: T extends { inputSource: infer S } ? S : 'MIDI' } {
  return createPracticeSessionPlanner()({ sourceId: 'practice-source-fixture', artifact }, {
    mode: 'CONTINUOUS_PLAY', recordingMode: 'OFF', inputSource: 'MIDI', scope: { kind: 'FULL' },
    tempoSelection: { mode: 'SCORE' }, metronomeEnabled: false, ...choices,
  }) as ContinuousPracticeSessionPlan & { inputSource: T extends { inputSource: infer S } ? S : 'MIDI' };
}
