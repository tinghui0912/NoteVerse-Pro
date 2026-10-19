// apps/customer-web/src/lib/practice/acoustic/source/source-adapter-identities.json
var source_adapter_identities_default = {
  "44100": {
    identity: {
      acousticCoreIdentitySha256: "93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443",
      coefficientSha256: "d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620",
      down: 441,
      realSourceLookaheadSamples: 28,
      runtimeFeed: "Unchanged XC5 CAPTURE branch and frozen XC4 FIR.",
      schemaVersion: 1,
      sourceRateHz: 44100,
      tapCount: 8821,
      targetRateHz: 16e3,
      up: 160
    },
    identitySha256: "32e39d991c47f5dbe1f13d2f77cf2a652d6a5da34cb5051ff43c0155b91edca5"
  },
  "48000": {
    identity: {
      acousticCoreIdentitySha256: "93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443",
      boundary: "Origin zeros only in first10 outputs, which are excluded from qualified model inputs. No padded finish.",
      coefficients: {
        bytes: 244,
        dtype: "float32-le",
        sha256: "0edd2896f0923a575a7f01fb2460b529409899e9ba187f213a36037f3ef9218f"
      },
      down: 3,
      firstFullyRealOutputIndex: 10,
      firwin: {
        cutoff: 0.3333333333333333,
        fs: 2,
        numtaps: 61,
        scale: true,
        window: [
          "kaiser",
          5
        ]
      },
      implementation: {
        path: "apps/customer-web/src/lib/practice/acoustic-inference/xc6-source-48000.ts",
        sha256: "752091275a67ea119c4b08b0c61b8866e017e1653d0a61fc929ae545cc610a72"
      },
      precision: "float32 input/coefficients/product/each accumulation",
      realSourceLookaheadMs: 0.625,
      realSourceLookaheadSamples: 30,
      runtimeFeed: "Qualified adapter uses the explicit already16k injection boundary; never assumes physical microphone16k. Outer publications retain original48k source coordinates.",
      schemaVersion: 1,
      scipyVersion: "1.14.1",
      sourceRateHz: 48e3,
      tapCount: 61,
      targetRateHz: 16e3,
      timeMapping: "Target sample m represents original source3*m; wait through source3*m+30. No fitted shift.",
      up: 1
    },
    identitySha256: "6003b89c69965259baf9b329be6faec19128e6e5743be952c23069fb8673da17"
  }
};

// apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts
var ACOUSTIC_MODEL = Object.freeze({
  identityName: "robust-browser-engineering-default-xc4-v1",
  identitySha256: "93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443",
  modelSha256: "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
  modelBytes: 98689283,
  ortVersion: "1.20.1",
  provider: "webgpu",
  automaticFallback: false,
  inputSamples: 29120,
  sampleRateHz: 16e3,
  inputMs: 1820,
  onsetThreshold: 0.3,
  frameThreshold: 0.05,
  ownedMs: 600,
  futureMs: 170,
  pastMs: 1050
});
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}
async function sha256(bytes) {
  const buffer = new Uint8Array(bytes).buffer;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function sourceIdentity(rate) {
  return source_adapter_identities_default[String(rate)];
}
function sourceRate(value) {
  if (value !== 44100 && value !== 48e3) fail("SOURCE_SAMPLE_RATE_NOT_QUALIFIED");
  return value;
}
var AcousticAnalysisError = class extends Error {
  constructor(code, options) {
    super(code, options);
    this.code = code;
    this.name = "AcousticAnalysisError";
  }
};
function fail(code) {
  throw new AcousticAnalysisError(code);
}

// apps/customer-web/src/lib/practice/acoustic/source/source-adapter.ts
var QualifiedSourceAdapter = class _QualifiedSourceAdapter {
  constructor(rate, coefficients) {
    this.rate = rate;
    this.coefficients = coefficients;
    this.ring = new Float32Array(128);
    this.received = 0;
    this.nextOutput = 0;
    this.firstFullyRealOutputIndex = 10;
    const identity = sourceIdentity(rate);
    this.identitySha256 = identity.identitySha256;
    this.up = rate === 44100 ? 160 : 1;
    this.down = rate === 44100 ? 441 : 3;
    this.center = (coefficients.length - 1) / 2;
  }
  static async create(rateHz, bytes) {
    const rate = sourceRate(rateHz), identity = sourceIdentity(rate);
    const expected = rate === 44100 ? "d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620" : "0edd2896f0923a575a7f01fb2460b529409899e9ba187f213a36037f3ef9218f";
    if (bytes.length !== (rate === 44100 ? 35284 : 244) || await sha256(bytes) !== expected) fail("FIR_IDENTITY_MISMATCH");
    if (await sha256(new TextEncoder().encode(canonicalJson(identity.identity))) !== identity.identitySha256) fail("SOURCE_ADAPTER_IDENTITY_MISMATCH");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return new _QualifiedSourceAdapter(rate, Float32Array.from({ length: bytes.length / 4 }, (_, i) => view.getFloat32(i * 4, true)));
  }
  push(input) {
    if (input.some((v) => !Number.isFinite(v))) fail("NONFINITE_CAPTURE_PCM");
    const output = [];
    for (const value of input) {
      this.ring[this.received++ % 128] = value;
      while (Math.floor((this.nextOutput * this.down + this.center) / this.up) < this.received) {
        const coordinate = this.nextOutput * this.down + this.center;
        const begin = Math.max(0, Math.ceil((coordinate - this.coefficients.length + 1) / this.up));
        const end = Math.floor(coordinate / this.up);
        let sum = 0;
        for (let n = begin; n <= end; n++) sum = Math.fround(sum + Math.fround(this.ring[n % 128] * this.coefficients[coordinate - n * this.up]));
        output.push(sum);
        this.nextOutput++;
      }
    }
    return Float32Array.from(output);
  }
  storageBytes() {
    return this.ring.byteLength + this.coefficients.byteLength;
  }
};

// backend/research/robust_geometry_v23/prepare-inputs.ts
function candidateWindow(old) {
  const endSample = Math.round(old.ownedEndTarget + 120 * 16);
  return { ...old, startSample: endSample - 29120, endSample };
}
async function reconstruct(source, rate, fir, windows) {
  const adapter = await QualifiedSourceAdapter.create(rate, fir), parts = [];
  let length = 0;
  for (let at = 0; at < source.length; at += 2048) {
    const part = adapter.push(source.subarray(at, at + 2048));
    parts.push(part);
    length += part.length;
  }
  const target = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    target.set(part, offset);
    offset += part.length;
  }
  return { identity: adapter.identitySha256, targetFrames: length, windows: windows.map((old) => {
    const window = candidateWindow(old);
    if (!Number.isInteger(window.startSample) || window.startSample < 10 || window.endSample > length) throw Error("REAL_INPUT_CONTEXT_UNAVAILABLE");
    const pcm = target.slice(window.startSample, window.endSample);
    if (pcm.length !== 29120 || pcm.some((value) => !Number.isFinite(value))) throw Error("FINITE_REAL_29120_INPUT_REQUIRED");
    if (old.startSample < 10 || old.endSample > length) throw Error("BASELINE_REFERENCE_CONTEXT_UNAVAILABLE");
    return { window, pcm, baselinePcm: target.slice(old.startSample, old.endSample) };
  }) };
}
export {
  candidateWindow,
  reconstruct
};
