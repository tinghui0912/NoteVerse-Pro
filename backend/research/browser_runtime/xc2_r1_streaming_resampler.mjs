// Rational zero-phase FIR interpolation. Coefficients are frozen SciPy 1.14.1
// firwin(8821, 1/441, window=('kaiser', 5.0)), float32, multiplied by 160.
// Compensation uses real future samples, never a backdated causal timestamp.
export class StreamingRationalResampler {
  constructor(coefficients) {
    if (coefficients.length !== 8821) throw new Error('R1_FIR_IDENTITY');
    this.h = coefficients; this.ring = new Float32Array(128); this.received = 0; this.nextOutput = 0; this.closed = false;
  }
  push(input) {
    if (this.closed) throw new Error('R1_RESAMPLER_CLOSED');
    const output = [];
    for (const value of input) {
      if (!Number.isFinite(value)) throw new Error('R1_RESAMPLER_NONFINITE');
      this.ring[this.received % 128] = value; this.received += 1;
      while (Math.floor((this.nextOutput * 441 + 4410) / 160) < this.received) {
        const coordinate = this.nextOutput * 441 + 4410;
        const begin = Math.max(0, Math.ceil((coordinate - 8820) / 160)), end = Math.floor(coordinate / 160);
        let sum = 0;
        for (let n = begin; n <= end; n += 1) sum = Math.fround(sum + Math.fround(this.ring[n % 128] * this.h[coordinate - n * 160]));
        output.push(sum); this.nextOutput += 1;
      }
    }
    return Float32Array.from(output);
  }
  finish() {
    const length = Math.ceil(this.received * 160 / 441), left = length - this.nextOutput;
    const padding = Math.max(0, Math.floor(((length - 1) * 441 + 4410) / 160) + 1 - this.received);
    const output = this.push(new Float32Array(padding)).slice(0, left); this.closed = true; return output;
  }
}
export const STREAMING_RESAMPLER_IDENTITY = Object.freeze({ sourceRateHz: 44100, targetRateHz: 16000,
  up: 160, down: 441, tapCount: 8821, highRateHalfLength: 4410, window: ['kaiser', 5],
  sourceLookaheadSamples: 4410 / 160, conservativeReadyLookaheadSamples: 28,
  delayCompensation: 'output m has source coordinate m*441/160; wait for real source floor((m*441+4410)/160)',
  memory: '128-source-sample ring plus caller-owned chunk output',
  precision: 'float32 input, coefficients, each multiply and accumulation rounded to float32',
  boundary: 'constant zero only at stream origin and explicit finish; runtime clip uses real +/-1-second guard',
  gainNormalization: false });
