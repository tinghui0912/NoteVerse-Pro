import { practiceApi } from '@/lib/api';
import { readPracticeBundle } from './bundle-envelope';

/** One fresh, complete transport request per explicit Setup command; no cache admission. */
export function admitPracticeBundle(
  scoreId: string,
  revisionId: string,
  signal: AbortSignal,
) {
  return readPracticeBundle(
    (signal) =>
      practiceApi.getPracticeBundle(scoreId, revisionId, true, signal),
    { kind: 'REVISION', scoreId, revisionId },
    signal,
  );
}
