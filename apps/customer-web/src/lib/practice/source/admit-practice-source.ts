import { practiceApi } from '@/lib/api';
import { readPracticeSource } from './source-envelope';

/** One fresh, complete transport request per explicit Setup command; no cache admission. */
export function admitPracticeSource(scoreId: string, revisionId: string, signal: AbortSignal) {
  return readPracticeSource(signal => practiceApi.getPracticeSource(scoreId, revisionId, true, signal),
    { kind: 'REVISION', scoreId, revisionId }, signal);
}
