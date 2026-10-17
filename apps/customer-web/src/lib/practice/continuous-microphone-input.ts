import type { ContinuousPracticeSession } from './local-core/performance-runtime';
import type { AcousticPublicationSink } from './acoustic/continuous/publication';

/** The single product ingestion boundary; no clock/transport authority is handed to analysis. */
export function continuousMicrophoneSink(session: Pick<ContinuousPracticeSession, 'publishAnalysis'>): AcousticPublicationSink {
  return publication => session.publishAnalysis(publication);
}
