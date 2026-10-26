import type { ContinuousControllerSnapshot } from './continuous-practice-controller';
import type { LocalPracticeInputState } from '@/lib/practice/input-state';
import type { ContinuousPracticeLifecycle } from '@/lib/practice/continuous/domain/session';

/** Presentation only: never advances transport or infers completion from clock alone. */
export function continuousControllerView(snapshot: ContinuousControllerSnapshot | null): {
  lifecycle: ContinuousPracticeLifecycle; inputState: LocalPracticeInputState; inputError: string | null;
} {
  if (!snapshot || snapshot.session === 'DISPOSED') return { lifecycle: 'READY', inputState: 'IDLE', inputError: null };
  if (snapshot.session === 'ABANDONED') return { lifecycle: 'READY', inputState: 'STARTING', inputError: null };
  const inputError = snapshot.inputError ?? snapshot.analysisError;
  const failed = snapshot.session === 'FAILED' || snapshot.session === 'FAILED_BEFORE_START';
  const lifecycle = failed ? 'ENDED' : !snapshot.transport ? 'READY' : snapshot.transport.state === 'ENDED' ? 'ENDED'
    : snapshot.transport.state === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
  return { lifecycle, inputError, inputState: inputError || failed ? 'ERROR'
    : snapshot.session === 'PREPARING' ? 'STARTING' : lifecycle === 'ACTIVE' ? 'RUNNING' : 'IDLE' };
}
