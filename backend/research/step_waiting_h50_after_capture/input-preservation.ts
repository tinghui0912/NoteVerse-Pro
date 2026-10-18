import {QualifiedSourceAdapter} from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-adapter';

export type Phase = Readonly<{id: string; eventOffsetMs: number}>;
export type WindowBounds = Readonly<{start: number; end: number; ownedStart: number; ownedEnd: number}>;

export function containingWindow(originTarget: number, eventTarget: number): WindowBounds {
  const index = Math.floor((eventTarget - originTarget) / 9600);
  if (index < 0) throw Error('EVENT_BEFORE_ANALYSIS_REGION');
  const ownedStart = originTarget + index * 9600, ownedEnd = ownedStart + 9600;
  const end = Math.round(ownedEnd + 2720);
  return {start: end - 29120, end, ownedStart, ownedEnd};
}

/** DSP-only source conversion. No Worker, model, decoder, score or truth access. */
export async function adapted(pcm: Float32Array, rate: number, coefficients: Uint8Array): Promise<Float32Array> {
  const adapter = await QualifiedSourceAdapter.create(rate, coefficients);
  const pieces: Float32Array[] = [];
  let size = 0;
  for (let i = 0; i < pcm.length; i += 2048) {
    const piece = adapter.push(pcm.subarray(i, i + 2048));
    size += piece.length; pieces.push(piece);
  }
  const output = new Float32Array(size);
  let at = 0;
  for (const piece of pieces) {output.set(piece, at); at += piece.length;}
  return output;
}

export function phaseWindow(eventTarget: number, phase: Phase): WindowBounds {
  const origin = eventTarget - phase.eventOffsetMs * 16;
  return containingWindow(origin, eventTarget);
}

export function realWindow(pcm: Float32Array, bounds: WindowBounds): Float32Array {
  if (bounds.start < 10 || bounds.end > pcm.length) throw Error('ORIGINAL_REAL_CONTEXT_UNAVAILABLE');
  return pcm.slice(bounds.start, bounds.end);
}
