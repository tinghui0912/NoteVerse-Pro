import { canonicalJson, sha256 } from '../identity';
import { fail } from '../errors';
import { sourceAdapterContract, sourceRate, type SourceRate } from './source-adapter-contract';

/** Frozen float32 rational FIR; the source ring is independent of session length. */
export class QualifiedSourceAdapter {
  private readonly ring: Float32Array;
  private received = 0;
  private nextOutput = 0;
  readonly firstFullyRealOutputIndex: number;
  readonly identitySha256: string;
  readonly up: number;
  readonly down: number;
  readonly center: number;
  private constructor(readonly rate: SourceRate, private readonly coefficients: Float32Array) {
    const identity = sourceAdapterContract(rate);
    this.identitySha256 = identity.identitySha256;
    this.up = identity.up;
    this.ring = new Float32Array(Math.ceil(coefficients.length / this.up));
    this.down = identity.down;
    this.center = (coefficients.length - 1) / 2;
    this.firstFullyRealOutputIndex = identity.firstFullyRealOutputIndex;
  }
  static async create(rateHz: number, bytes: Uint8Array): Promise<QualifiedSourceAdapter> {
    const rate = sourceRate(rateHz), identity = sourceAdapterContract(rate);
    if(bytes.length !== identity.coefficientAsset.byteSize || await sha256(bytes) !== identity.coefficientAsset.sha256) fail('FIR_IDENTITY_MISMATCH');
    // The source identity is provenance, not a runtime policy selector.
    if(await sha256(new TextEncoder().encode(canonicalJson(Object.fromEntries(Object.entries(identity).filter(([key]) => key !== 'identitySha256'))))) !== identity.identitySha256) fail('SOURCE_ADAPTER_IDENTITY_MISMATCH');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new QualifiedSourceAdapter(rate, Float32Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true)));
  }
  push(input: Float32Array): Float32Array {
    if (input.some(v => !Number.isFinite(v))) fail('NONFINITE_CAPTURE_PCM');
    const output: number[] = [];
    for (const value of input) {
      this.ring[this.received++ % this.ring.length] = value;
      while (Math.floor((this.nextOutput * this.down + this.center) / this.up) < this.received) {
        const coordinate = this.nextOutput * this.down + this.center;
        const begin = Math.max(0, Math.ceil((coordinate - this.coefficients.length + 1) / this.up));
        const end = Math.floor(coordinate / this.up);
        let sum = 0;
        for (let n = begin; n <= end; n++) sum = Math.fround(sum + Math.fround(this.ring[n % this.ring.length] * this.coefficients[coordinate - n * this.up]));
        output.push(sum); this.nextOutput++;
      }
    }
    return Float32Array.from(output);
  }
  storageBytes(): number { return this.ring.byteLength + this.coefficients.byteLength; }
}
