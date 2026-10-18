import '../qualification/transport-diagnostics';
import { BrowserAcousticCapture } from '../../src/lib/practice/acoustic/source/capture';
import { ContinuousCaptureBridge } from '../../src/lib/practice/acoustic/continuous/capture-bridge';
import type { ContinuousAcousticProjection } from '../../src/lib/practice/acoustic/continuous/continuous-projection';
declare global { interface Window { runAggregationTrial(rate: number, stallMs: number | null): Promise<unknown>; } }
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
window.runAggregationTrial = async (rate, stallMs) => {
  const context = new AudioContext({ sampleRate: rate });
  const root = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const clones: MediaStream[] = [], clone = root.clone.bind(root);
  root.clone = () => { const stream = clone(); clones.push(stream); return stream; };
  let failure: string | null = null, acceptedSamples = 0, cleanup: (() => void) | null = null;
  const sink = { append: (block: { samples: Float32Array }) => { acceptedSamples += block.samples.length; },
    attachCaptureCleanup: (fn: () => void) => { cleanup = fn; return () => { cleanup = null; }; },
    failAnalysis: (error: unknown) => { failure ??= String(error); cleanup?.(); } };
  const bridge = new ContinuousCaptureBridge(sink as unknown as ContinuousAcousticProjection, rate);
  let capture: BrowserAcousticCapture | null = null, ready: object | null = null, stall: object | null = null;
  const startedAtWallMs = performance.now();
  try {
    await context.resume();
    capture = await BrowserAcousticCapture.connect({ bridge, stream: root, context, ownership: 'BORROWED_SESSION_STREAM', workletUrl: '/capture.worklet.js' });
    ready = { wallTime: performance.now(), contextTime: context.currentTime, timeToTransportReadyMs: performance.now() - startedAtWallMs,
      capture: bridge.snapshot(), diagnostics: window.qualificationTransportDiagnostics() };
    if (stallMs !== null) {
      await sleep(600); const start = performance.now(), beforeContextTime = context.currentTime;
      while (performance.now() - start < stallMs) { /* Frozen engineering stress only. */ }
      stall = { requestedMs: stallMs, actualMs: performance.now() - start, startWallMs: start, beforeContextTime, afterContextTime: context.currentTime };
      await sleep(1000);
    } else await sleep(300);
  } catch (error) { failure ??= String(error); }
  const result = { rate, actualRate: context.sampleRate, ready, stall, failure, acceptedSamples, capture: bridge.snapshot(),
    diagnostics: window.qualificationTransportDiagnostics(), contextStateBeforeCleanup: context.state,
    neuralRuns: 0, cleanup: {} };
  capture?.stop(); for (const track of root.getTracks()) track.stop(); await context.close();
  result.cleanup = { contextClosed: context.state === 'closed', rootEnded: root.getTracks().every(t => t.readyState === 'ended'),
    clones: clones.length, allAnalysisClonesEnded: clones.every(s => s.getTracks().every(t => t.readyState === 'ended')) };
  return result;
};
