import '../qualification/transport-diagnostics';
import { BrowserAcousticCapture } from '../../src/lib/practice/acoustic/source/capture';
import { ContinuousCaptureBridge } from '../../src/lib/practice/acoustic/continuous/capture-bridge';
import type { ContinuousAcousticProjection } from '../../src/lib/practice/acoustic/continuous/continuous-projection';

declare global { interface Window { runTransportStress(rate: number, stallMs: number): Promise<unknown>; } }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
window.runTransportStress = async (rate, stallMs) => {
  const context = new AudioContext({ sampleRate: rate });
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  let failure: string | null = null, samplesAccepted = 0, appends = 0, cleanup: (() => void) | null = null;
  const sink = { append: (block: { samples: Float32Array }) => { samplesAccepted += block.samples.length; appends++; },
    attachCaptureCleanup: (fn: () => void) => { cleanup = fn; return () => { cleanup = null; }; },
    failAnalysis: (error: unknown) => { failure = String(error); cleanup?.(); } };
  const bridge = new ContinuousCaptureBridge(sink as unknown as ContinuousAcousticProjection, rate);
  let capture: BrowserAcousticCapture | null = null;
  try {
    await context.resume();
    capture = await BrowserAcousticCapture.connect({ bridge, context, stream, ownership: 'BORROWED_SESSION_STREAM', workletUrl: '/capture.worklet.js' });
    await sleep(600);
    const before = { wallTime: performance.now(), contextTime: context.currentTime, capture: bridge.snapshot() };
    const end = performance.now() + stallMs;
    while (performance.now() < end) { /* Fixed qualification-only main-thread stall. */ }
    const after = { wallTime: performance.now(), contextTime: context.currentTime };
    await sleep(1000);
    return { rate, actualRate: context.sampleRate, stallMs, before, after, failure, samplesAccepted, appends,
      capture: bridge.snapshot(), contextState: context.state, rootTracks: stream.getTracks().map(t => t.readyState),
      diagnostics: window.qualificationTransportDiagnostics(), neuralRuns: 0 };
  } finally {
    capture?.stop(); for (const track of stream.getTracks()) track.stop(); await context.close();
  }
};
