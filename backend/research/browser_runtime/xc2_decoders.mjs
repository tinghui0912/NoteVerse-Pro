import { decodeRobustRawOutputs, filterOwnedObservations } from './xc1_robust_decoder.mjs';

export const XC2_DECODER_POLICY = Object.freeze({ onsetThreshold: 0.30, frameThreshold: 0.05,
  outputFrameRateHz: 100, upstreamNeighbour: 2, consensusToleranceMs: 20,
  upstream: 'piano-transcription-inference==0.0.6 RegressionPostProcessor.get_binarized_output_from_regression; onset-only projection',
  hybrid: 'NEW_PROSPECTIVE_HYBRID_SAFE_EXPERIMENT; maximum-cardinality/min-error same-pitch consensus, CURRENT time and minimum confidence' });

export function planXc2Windows({ sampleCount, ownedMs = 600, futureMs = 220 }) {
  const duration = sampleCount / 16, end = duration - 220, rows = [];
  // The shortest stride/future pair needs 1380ms real past context.
  for (let start = 1380; start < end; start += ownedMs) {
    const ownedEndMs = Math.min(start + ownedMs, end), inputWindowEndMs = ownedEndMs + futureMs;
    const endSample = Math.round(inputWindowEndMs * 16), startSample = endSample - 29120;
    if (startSample < 0 || endSample > sampleCount) throw new Error('XC2_REAL_CONTEXT_REQUIRED');
    rows.push({ windowId: `owned_${start}`, ownedStartMs: start, ownedEndMs,
      inputWindowStartMs: startSample / 16, inputWindowEndMs: endSample / 16,
      startSample, endSample, readyMs: endSample / 16, shiftedFinalWindow: ownedEndMs - start < ownedMs });
  }
  return rows;
}

export function upstreamOnsetProjection({ regData, frameData, dims, inputWindowStartMs, takeId, windowId }) {
  const frames = dims.at(-2), events = [];
  if (dims.at(-1) !== 88 || regData.length !== frames * 88 || frameData.length !== regData.length) throw new Error('XC2_RAW_SHAPE');
  // Score-blind onset-time subset of the pinned MIT upstream postprocessor.
  // Its frame threshold affects note offsets, not creation of onset proposals.
  for (let pitch = 0; pitch < 88; pitch += 1) for (let n = 2; n < frames - 2; n += 1) {
    const at = index => regData[index * 88 + pitch];
    if (!(at(n) > 0.30)) continue;
    let monotonic = true;
    for (let i = 0; i < 2; i += 1) if (at(n - i) < at(n - i - 1) || at(n + i) < at(n + i + 1)) monotonic = false;
    if (!monotonic) continue;
    const denominator = at(n - 1) > at(n + 1) ? at(n) - at(n + 1) : at(n) - at(n - 1);
    // Upstream stores the interpolated shift in a float32 array.
    const shift = Math.fround((at(n + 1) - at(n - 1)) / denominator / 2);
    if (!Number.isFinite(shift)) throw new Error('XC2_UPSTREAM_NONFINITE_SHIFT');
    events.push({ pitch: pitch + 21, peakFrame: n, shift,
      performanceTimeMs: inputWindowStartMs + (n + shift) * 10,
      confidence: at(n), onsetScore: at(n), frameScore: frameData[n * 88 + pitch],
      candidateObservationId: ['xc2', takeId, windowId, 'B', pitch + 21, n].join(':') });
  }
  return events.sort((a, b) => a.performanceTimeMs - b.performanceTimeMs || a.pitch - b.pitch || a.candidateObservationId.localeCompare(b.candidateObservationId));
}

export function consensus(current, upstream) {
  const output = [];
  for (let pitch = 21; pitch <= 108; pitch += 1) {
    const a = current.filter(event => event.pitch === pitch), b = upstream.filter(event => event.pitch === pitch);
    const table = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => ({ pairs: [], cost: 0 })));
    for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) {
      const choices = [table[i + 1][j], table[i][j + 1]], error = Math.abs(a[i].performanceTimeMs - b[j].performanceTimeMs);
      if (error <= 20) choices.push({ pairs: [[i, j], ...table[i + 1][j + 1].pairs], cost: error + table[i + 1][j + 1].cost });
      choices.sort((x, y) => y.pairs.length - x.pairs.length || x.cost - y.cost || JSON.stringify(x.pairs).localeCompare(JSON.stringify(y.pairs)));
      table[i][j] = choices[0];
    }
    for (const [i, j] of table[0][0].pairs) output.push({ ...a[i], confidence: Math.min(a[i].confidence, b[j].confidence),
      candidateObservationId: `${a[i].candidateObservationId}:C`, consensusObservationIds: [a[i].candidateObservationId, b[j].candidateObservationId] });
  }
  return output.sort((a, b) => a.performanceTimeMs - b.performanceTimeMs || a.pitch - b.pitch);
}

export function decodeXc2(raw, decoder) {
  const a = () => decodeRobustRawOutputs(raw), b = () => upstreamOnsetProjection(raw);
  const events = decoder === 'A' ? a() : decoder === 'B' ? b() : decoder === 'C' ? consensus(a(), b()) : null;
  if (!events) throw new Error('UNKNOWN_FROZEN_DECODER');
  return filterOwnedObservations(events, raw.spec.ownedStartMs, raw.spec.ownedEndMs);
}

export function inclusiveFrontier(endMs) {
  const value = new Float64Array([endMs]); const bits = new BigUint64Array(value.buffer); bits[0] -= 1n; return value[0];
}
