import { AudioContextFailure } from '@/lib/practice/failure/causal-failure';
import { createPracticeAudioContext, resumePracticeAudioContext } from '@/lib/practice/failure/browser-failures';
import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';
import { QualifiedSourceAdapter } from '@/lib/practice/acoustic/source/source-adapter';

/** Temporary processing pipeline on the retained microphone; never owns its tracks. */
export async function validateAcousticCapture(inputMicrophone: MediaStream, signal: AbortSignal): Promise<void> {
  let context: AudioContext | null = null, capture: { stop(): void } | null = null;
  let contextClosed: Promise<void> | null = null;
  const cleanup = () => {
    const current = capture; capture = null;
    try { current?.stop(); }
    finally { if (context && context.state !== 'closed' && !contextClosed) contextClosed = context.close(); }
  };
  const abort = () => { cleanup(); void contextClosed?.catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    context = createPracticeAudioContext();
    await resumePracticeAudioContext(context); signal.throwIfAborted();
    if (context.state !== 'running') throw new AudioContextFailure(context.state === 'closed' ? 'CLOSED' : 'INTERRUPTED');
    const adapter = await QualifiedSourceAdapter.create(context.sampleRate, await browserMicrophoneCapture.coefficients(context.sampleRate));
    signal.throwIfAborted();
    capture = await browserMicrophoneCapture.connectCapture({ context, stream: inputMicrophone, ownership: 'BORROWED_SESSION_STREAM',
      workletUrl: browserMicrophoneCapture.workletUrl, bridge: {
        receive: chunk => { adapter.push(chunk.samples); }, abort: () => {}, attachCaptureCleanup: () => () => {},
      } });
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', abort);
    cleanup(); await contextClosed;
  }
}
