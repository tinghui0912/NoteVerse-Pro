import { QualifiedSourceAdapter } from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter';
import { planWindow, type AnalysisRegion } from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner';

/** Preparation only: exact production FIR/planner, no model or observation producer. */
export async function reconstruct(source: Float32Array, rate: number, fir: Uint8Array,
  sourceOrigin: number, regionStart: number, regionEnd: number) {
  const adapter = await QualifiedSourceAdapter.create(rate, fir), parts: Float32Array[] = [];
  let frames = 0;
  for (let at = 0; at < source.length; at += 2048) {
    const part = adapter.push(source.subarray(at, at + 2048)); parts.push(part); frames += part.length;
  }
  const target = new Float32Array(frames); let at = 0;
  for (const part of parts) { target.set(part, at); at += part.length; }
  const originTarget = (regionStart - sourceOrigin) * 16000 / rate;
  const region: AnalysisRegion = { index: 0, sourceStart: regionStart, originTarget,
    nextWindow: 0, queuedEndTarget: originTarget,
    endTarget: originTarget + (regionEnd - regionStart) * 16000 / rate };
  const windows = [];
  for (;;) {
    const window = planWindow(region, windows.length); if (!window) break;
    if (window.startSample < 10 || window.endSample > target.length) throw Error('REAL_INPUT_COVERAGE');
    windows.push({ window, pcm: target.slice(window.startSample, window.endSample) }); region.nextWindow++;
  }
  return { identity: adapter.identitySha256, targetFrames: frames, windows };
}
