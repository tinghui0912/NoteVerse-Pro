import {QualifiedSourceAdapter} from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter';
import {planWindow, type AnalysisRegion} from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner';

/** Offline verification only. The implementation is the production adapter/planner. */
export async function adapt(pcm: Float32Array, rate: number, coefficients: Uint8Array): Promise<{pcm: Float32Array; identity: string}> {
  const adapter = await QualifiedSourceAdapter.create(rate, coefficients);
  const pieces: Float32Array[] = [];
  let length = 0;
  for (let at = 0; at < pcm.length; at += 2048) {
    const part = adapter.push(pcm.subarray(at, at + 2048));
    pieces.push(part); length += part.length;
  }
  const result = new Float32Array(length);
  let at = 0;
  for (const part of pieces) {result.set(part, at); at += part.length;}
  return {pcm: result, identity: adapter.identitySha256};
}

export function windows(length: number) {
  const region: AnalysisRegion = {index: 0, sourceStart: 0, originTarget: 19200,
    nextWindow: 0, queuedEndTarget: 19200, endTarget: length - 2720};
  const result = [];
  for (;;) {
    const window = planWindow(region, result.length);
    if (window === null) break;
    if (window.startSample < 10 || window.endSample > length || window.endSample - window.startSample !== 29120) {
      throw Error('REAL_MODEL_INPUT_CONTEXT_UNAVAILABLE');
    }
    result.push(window); region.nextWindow++;
  }
  return result;
}
