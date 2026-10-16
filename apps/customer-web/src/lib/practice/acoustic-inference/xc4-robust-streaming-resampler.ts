import { XC4, sha256 } from './xc4-robust-runtime-contract';

/** Exact float32 port of the frozen R1 rational FIR. No padded finish API. */
export class Xc4StreamingResampler {
  private readonly ring = new Float32Array(128);
  private received = 0;
  private nextOutput = 0;
  private constructor(private readonly h: Float32Array) {}

  static async create(bytes: Uint8Array): Promise<Xc4StreamingResampler> {
    bytes = new Uint8Array(bytes);
    if (bytes.byteLength !== XC4.coefficientBytes || await sha256(bytes) !== XC4.coefficientSha256) {
      throw new Error('XC4_FIR_IDENTITY_DRIFT');
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const h = Float32Array.from({ length: XC4.taps }, (_, i) => view.getFloat32(i * 4, true));
    return new Xc4StreamingResampler(h);
  }

  push(input: Float32Array): Float32Array {
    if (input.some(v => !Number.isFinite(v))) throw new Error('XC4_NONFINITE_PCM');
    const output: number[] = [];
    for (const value of input) {
      this.ring[this.received % 128] = value; this.received++;
      while (Math.floor((this.nextOutput * 441 + 4410) / 160) < this.received) {
        const coordinate = this.nextOutput * 441 + 4410;
        const begin = Math.max(0, Math.ceil((coordinate - 8820) / 160));
        const end = Math.floor(coordinate / 160);
        let sum = 0;
        for (let n = begin; n <= end; n++) {
          sum = Math.fround(sum + Math.fround(this.ring[n % 128] * this.h[coordinate - n * 160]));
        }
        output.push(sum); this.nextOutput++;
      }
    }
    return Float32Array.from(output);
  }

  // Outputs before index10 involve the historical FIR origin zero boundary.
  // They can be retained for audit, but cannot occur in a qualified model input.
  readonly firstFullyRealOutputIndex = 10;
}
