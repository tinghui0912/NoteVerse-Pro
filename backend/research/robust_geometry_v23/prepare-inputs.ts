import { QualifiedSourceAdapter } from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter';
import type { AcousticWindow } from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/window-planner';

export function candidateWindow(old: AcousticWindow): AcousticWindow {
  const endSample = Math.round(old.ownedEndTarget + 120 * 16);
  return { ...old, startSample: endSample - 29120, endSample };
}

/** Exact production source adapter; context changes, source/ownership identities do not. */
export async function reconstruct(source: Float32Array, rate: number, fir: Uint8Array, windows: AcousticWindow[]) {
  const adapter = await QualifiedSourceAdapter.create(rate, fir), parts: Float32Array[] = [];
  let length = 0;
  for (let at = 0; at < source.length; at += 2048) {
    const part = adapter.push(source.subarray(at, at + 2048)); parts.push(part); length += part.length;
  }
  const target = new Float32Array(length); let offset = 0;
  for (const part of parts) { target.set(part, offset); offset += part.length; }
  return { identity: adapter.identitySha256, targetFrames: length, windows: windows.map(old => {
    const window = candidateWindow(old);
    if (!Number.isInteger(window.startSample) || window.startSample < 10 || window.endSample > length) throw Error('REAL_INPUT_CONTEXT_UNAVAILABLE');
    const pcm = target.slice(window.startSample, window.endSample);
    if (pcm.length !== 29120 || pcm.some(value => !Number.isFinite(value))) throw Error('FINITE_REAL_29120_INPUT_REQUIRED');
    if (old.startSample < 10 || old.endSample > length) throw Error('BASELINE_REFERENCE_CONTEXT_UNAVAILABLE');
    return { window, pcm, baselinePcm: target.slice(old.startSample, old.endSample) };
  }) };
}
