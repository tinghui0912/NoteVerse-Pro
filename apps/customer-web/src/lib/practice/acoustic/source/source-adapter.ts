import { canonicalJson, fail, sha256, sourceIdentity, sourceRate, type SourceRate } from '../model/model-contract';

/** Frozen float32 rational FIR; the source ring is independent of session length. */
export class QualifiedSourceAdapter {
  private readonly ring = new Float32Array(128);
  private received = 0;
  private nextOutput = 0;
  readonly firstFullyRealOutputIndex = 10;
  readonly identitySha256: string;
  readonly up: number;
  readonly down: number;
  readonly center: number;
  private constructor(readonly rate: SourceRate, private readonly coefficients: Float32Array) {
    const identity = sourceIdentity(rate);
    this.identitySha256 = identity.identitySha256;
    this.up = rate === 44100 ? 160 : 1;
    this.down = rate === 44100 ? 441 : 3;
    this.center = (coefficients.length - 1) / 2;
  }
  static async create(rateHz: number, bytes: Uint8Array): Promise<QualifiedSourceAdapter> {
    const rate = sourceRate(rateHz), identity = sourceIdentity(rate);
    const expected = rate === 44100
      ? 'd54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620'
      : '0edd2896f0923a575a7f01fb2460b529409899e9ba187f213a36037f3ef9218f';
    if (bytes.length !== (rate === 44100 ? 35284 : 244) || await sha256(bytes) !== expected) fail('FIR_IDENTITY_MISMATCH');
    // The source identity is provenance, not a runtime policy selector.
    if (await sha256(new TextEncoder().encode(canonicalJson(identity.identity))) !== identity.identitySha256) fail('SOURCE_ADAPTER_IDENTITY_MISMATCH');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new QualifiedSourceAdapter(rate, Float32Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true)));
  }
  push(input: Float32Array): Float32Array {
    if (input.some(v => !Number.isFinite(v))) fail('NONFINITE_CAPTURE_PCM');
    const output: number[] = [];
    for (const value of input) {
      this.ring[this.received++ % 128] = value;
      while (Math.floor((this.nextOutput * this.down + this.center) / this.up) < this.received) {
        const coordinate = this.nextOutput * this.down + this.center;
        const begin = Math.max(0, Math.ceil((coordinate - this.coefficients.length + 1) / this.up));
        const end = Math.floor(coordinate / this.up);
        let sum = 0;
        for (let n = begin; n <= end; n++) sum = Math.fround(sum + Math.fround(this.ring[n % 128] * this.coefficients[coordinate - n * this.up]));
        output.push(sum); this.nextOutput++;
      }
    }
    return Float32Array.from(output);
  }
  storageBytes(): number { return this.ring.byteLength + this.coefficients.byteLength; }
}
