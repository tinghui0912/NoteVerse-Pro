import type { PracticeScope } from '@/lib/practice/kernel/scope';
import type { PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import type { RuntimeVersionIdentity } from '@/lib/practice/kernel/timebase';

export type PracticeMode = 'STEP_BY_STEP' | 'CONTINUOUS_PLAY';

export type PracticeInputSource = 'MICROPHONE' | 'MIDI';


export type LocalPracticeCompletionReason = 'SCOPE_COMPLETED' | 'STOPPED_BY_USER';

export type LocalPracticeSessionBase = {
  /** Local practice-instance identity, never a backend or transport session. */
  localSessionId: string;
  scoreId: string;
  revisionId: string;
  artifactId: string;
  mode: PracticeMode;
  inputSource: PracticeInputSource;
  practiceScope: PracticeScope;
  tempoSelection: PracticeTempoSelection;
  metronomeEnabled: boolean;
  completionReason: LocalPracticeCompletionReason | null;
  version: RuntimeVersionIdentity;
  createdAtMs: number;
  updatedAtMs: number;
};

export function createLocalSessionId(prefix = 'local-practice'): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}
