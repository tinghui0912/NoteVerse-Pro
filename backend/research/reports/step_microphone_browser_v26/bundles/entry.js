// apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json
var acoustic_core_identity_default = {
  acousticPublication: {
    executorSource: {
      bytes: 3277,
      path: "backend/research/browser_runtime/xc2_r1_browser_acoustic.mjs",
      sha256: "eae417d8011e7df1f8b30bf4588cfbaedc695a5f66ea2bf1a2043c4b1a419f83"
    },
    publicationReferenceSource: {
      bytes: 12936,
      path: "backend/research/browser_runtime/xc2_r1_runtime.mjs",
      sha256: "72e45a94a245d34a40afba53fd18b0c685efa16f5981c46766a61d0c1aa26ab1"
    },
    scope: "Acoustic semantics only; reference runtime downstream finalizer is explicitly excluded from default. No production wiring.",
    semantics: "One session per execution, sequential windows, all-pitch decoder A, half-open ownership, stable observation ID, immutable performanceTimeMs and confidence; availabilityTimeMs uses actual acoustic publication on performance-origin clock; analyzed-through frontier is preceding float64 of ownedEnd. No score, labels, final verdicts or expected pitch in acoustic execution."
  },
  decoder: {
    authoritativeSource: {
      bytes: 5006,
      path: "apps/customer-web/src/lib/practice/acoustic-inference/bytedance-decoder.ts",
      sha256: "07d5cb1d709c99ab85f8b701fd0bdf1744b4135b4d7dbd21deb679029e541311"
    },
    default: "A",
    frameThreshold: 0.05,
    function: "decodeByteDanceRawOutputs",
    onsetThreshold: 0.3,
    outputFrameRateHz: 100,
    researchParitySource: {
      bytes: 5477,
      path: "backend/research/browser_runtime/xc1_robust_decoder.mjs",
      sha256: "33a032a7508c488cf7eb1db9b60b3f6a921756eab798c5d84875d634b5925125"
    },
    semantics: "Contiguous >=onset threshold region; first maximum peak; reject peak if frame support <threshold; confidence=min(onset,frame); piano MIDI21..108; sort by time,pitch,stable ID.",
    timeMapping: "inputWindowStartMs + round(peakFrame/100*16000)/16000*1000"
  },
  identityName: "robust-browser-engineering-default-xc4-v1",
  input: {
    dtype: "float32",
    modelInputMs: 1820,
    modelInputSamples: 29120,
    sampleRateHz: 16e3,
    shape: [
      1,
      29120
    ]
  },
  model: {
    candidateId: "bytedance-robust-augmented-calibrated-v1",
    checkpointBytes: 103815845,
    checkpointSha256: "b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e",
    onnxBytes: 98689283,
    onnxSha256: "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
    sourceConfigurationSha256: "10ca01435f68b0672d01e2328762ea0773efb15b318dcd1c21105e05f9ee51ce"
  },
  ownership: {
    fullWindowPastMs: 1050,
    futureContextMs: 170,
    input: "inputEnd=ownedEnd+170ms; inputStart=inputEnd-1820ms; exactly29120 real samples; final partial ownership shifts full input without padding.",
    ownedMs: 600,
    plannerFunction: "planXc2Windows; selected parameters ownedMs=600,futureMs=170; historical common clip guard remains historical, not a new live startup specification.",
    plannerSource: {
      bytes: 4785,
      path: "backend/research/browser_runtime/xc2_decoders.mjs",
      sha256: "4a81ac847b62485ff1ed13e865736b418c798515abd886b0fdef7dfdd992efbf"
    },
    rule: "[ownedStartMs,ownedEndMs)"
  },
  resampler: {
    algorithm: "Frozen SciPy 1.14.1 firwin(8821,1/441,kaiser beta=5); float32 coefficients multiplied by160; float32 products/accumulation.",
    boundary: "Preserve state across chunks. Zero only at stream origin or explicit finish; padded finish cannot qualify real-context owned observations.",
    coefficients: {
      bytes: 35284,
      path: "backend/data/work/xc2_r1_bounded_runtime/audio_only/fir_160_441.f32",
      sha256: "d54df355dba1e60395e165f0a44a3d016e25632af639be767c861e1bfd61e620"
    },
    conservativeReadyLookaheadMs: 0.6349206349206349,
    conservativeReadyLookaheadSamples: 28,
    default: "BAND_LIMITED",
    down: 441,
    lookaheadSourceSamples: 27.5625,
    source: {
      bytes: 2289,
      path: "backend/research/browser_runtime/xc2_r1_streaming_resampler.mjs",
      sha256: "5f57a366bd3c264bee427caa33f892c1ea69d5954c5074a9c37f5167d3f07583"
    },
    sourceRateHz: 44100,
    tapCount: 8821,
    targetRateHz: 16e3,
    timeMapping: "Output m represents source m*441/160; wait for real source floor((m*441+4410)/160). No fitted shift or gain normalization.",
    up: 160
  },
  runtime: {
    automaticFallback: false,
    browserLibrary: {
      bytes: 333594,
      path: "backend/research/browser_runtime/xc1_ort120_runtime/node_modules/onnxruntime-web/dist/ort.webgpu.min.js",
      sha256: "8443389bf14b34582ea40c590b5007bb652d6ac07dd76829a5bd82d2372e6895"
    },
    graphOptimizationLevel: "disabled",
    ortWebVersion: "1.20.1",
    packageLock: {
      bytes: 6697,
      path: "backend/research/browser_runtime/xc1_ort120_runtime/package-lock.json",
      sha256: "7268737984b6c01ca800a3512a69c7656215fc7f19dede78b43f40752bc4f449"
    },
    provider: "webgpu"
  }
};

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
async function assertAcousticIdentity() {
  const hash = await sha256(new TextEncoder().encode(canonicalJson(acoustic_core_identity_default)));
  if (hash !== ACOUSTIC_MODEL.identitySha256 || acoustic_core_identity_default.model.onnxSha256 !== ACOUSTIC_MODEL.modelSha256 || acoustic_core_identity_default.model.onnxBytes !== ACOUSTIC_MODEL.modelBytes || acoustic_core_identity_default.input.modelInputSamples !== ACOUSTIC_MODEL.inputSamples || acoustic_core_identity_default.input.sampleRateHz !== ACOUSTIC_MODEL.sampleRateHz || acoustic_core_identity_default.input.modelInputMs !== ACOUSTIC_MODEL.inputMs || acoustic_core_identity_default.runtime.ortWebVersion !== ACOUSTIC_MODEL.ortVersion || acoustic_core_identity_default.runtime.provider !== ACOUSTIC_MODEL.provider || acoustic_core_identity_default.runtime.automaticFallback !== ACOUSTIC_MODEL.automaticFallback || acoustic_core_identity_default.decoder.default !== "A" || acoustic_core_identity_default.decoder.onsetThreshold !== ACOUSTIC_MODEL.onsetThreshold || acoustic_core_identity_default.decoder.frameThreshold !== ACOUSTIC_MODEL.frameThreshold || acoustic_core_identity_default.ownership.ownedMs !== ACOUSTIC_MODEL.ownedMs || acoustic_core_identity_default.ownership.futureContextMs !== ACOUSTIC_MODEL.futureMs || acoustic_core_identity_default.ownership.fullWindowPastMs !== ACOUSTIC_MODEL.pastMs) fail("ACOUSTIC_IDENTITY_DRIFT");
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
function onlyFields(value, allowed) {
  if (!value || Object.keys(value).some((k) => !allowed.includes(k))) fail("ACOUSTIC_FIELD_VIOLATION");
}
function safeIndex(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_SOURCE_SAMPLE_IDENTITY");
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

// apps/customer-web/src/lib/practice/acoustic/runtime/resource-policy.ts
var ACOUSTIC_RESOURCES = Object.freeze({
  maxOutstandingWindows: 4,
  maxUnacknowledgedBlocks: 32,
  maxSourceBlockSamples: 2048,
  diagnosticWindows: 32,
  targetRingSamples: 65536,
  inputBytes: 29120 * 4,
  maxEventsPerWindow: 183 * 88,
  // Bounds rapid control changes as well as PCM; failure never changes transport.
  maxPendingSegments: 4,
  maxScheduledBoundaries: 8
});
function retainCompact(ring, entry) {
  if (ring.length === ACOUSTIC_RESOURCES.diagnosticWindows) ring.shift();
  ring.push(entry);
}

// apps/customer-web/src/lib/practice/acoustic/runtime/window-planner.ts
function planWindow(segment, jobIndex) {
  const ownedStartTarget = segment.originTarget + segment.nextWindow * ACOUSTIC_MODEL.ownedMs * 16;
  const ownedEndTarget = Math.min(ownedStartTarget + ACOUSTIC_MODEL.ownedMs * 16, segment.endTarget ?? Infinity);
  if (ownedEndTarget <= ownedStartTarget) return null;
  const endSample = Math.round(ownedEndTarget + ACOUSTIC_MODEL.futureMs * 16);
  const startSample = endSample - ACOUSTIC_MODEL.inputSamples;
  return Object.freeze({
    jobIndex,
    regionIndex: segment.index,
    windowIndex: segment.nextWindow,
    ownedStartTarget,
    ownedEndTarget,
    startSample,
    endSample
  });
}
var AcousticPcmRing = class {
  constructor() {
    this.pcm = new Float32Array(ACOUSTIC_RESOURCES.targetRingSamples);
    this.end = 0;
  }
  get length() {
    return this.end;
  }
  get firstRetained() {
    return Math.max(0, this.end - this.pcm.length);
  }
  append(input) {
    for (const value of input) this.pcm[this.end++ % this.pcm.length] = value;
  }
  extract(start, end) {
    if (!Number.isInteger(start) || end - start !== ACOUSTIC_MODEL.inputSamples || start < Math.max(10, this.firstRetained) || end > this.end) fail("REAL_ACOUSTIC_CONTEXT_UNAVAILABLE");
    return Float32Array.from({ length: end - start }, (_, i) => this.pcm[(start + i) % this.pcm.length]);
  }
};

// apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts
function sourcePublication(domain, rate, base, window2, result, availabilityTimeMs) {
  if (result.events.length > ACOUSTIC_RESOURCES.maxEventsPerWindow) fail("ACOUSTIC_EVENT_BOUND_EXCEEDED");
  const ids = /* @__PURE__ */ new Set();
  const observations = result.events.filter((e) => e.targetSample >= window2.ownedStartTarget && e.targetSample < window2.ownedEndTarget).map((e) => {
    if (!Number.isSafeInteger(e.targetSample) || !Number.isInteger(e.midiPitch) || e.midiPitch < 21 || e.midiPitch > 108 || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1 || !Number.isFinite(e.onsetScore) || !Number.isFinite(e.frameScore)) fail("ACOUSTIC_EVENT_IDENTITY_MISMATCH");
    const numerator = base * 16e3 + e.targetSample * rate;
    if (!Number.isSafeInteger(numerator)) fail("ACOUSTIC_SOURCE_COORDINATE_OVERFLOW");
    const observationId = `${domain}:r${window2.regionIndex}:w${window2.windowIndex}:p${e.midiPitch}:f${e.targetSample}`;
    if (ids.has(observationId)) fail("DUPLICATE_ACOUSTIC_OBSERVATION");
    ids.add(observationId);
    return Object.freeze({
      observationId,
      pitch: e.pitch,
      midiPitch: e.midiPitch,
      confidence: e.confidence,
      sourceDomainId: domain,
      sourceSampleRateHz: rate,
      sourceEventSample: numerator / 16e3,
      targetSample: e.targetSample
    });
  });
  const ownedThroughSourceSample = base + window2.ownedEndTarget * rate / 16e3;
  if (!Number.isFinite(ownedThroughSourceSample) || ownedThroughSourceSample < 0 || ownedThroughSourceSample > Number.MAX_SAFE_INTEGER) fail("ACOUSTIC_SOURCE_COORDINATE_OVERFLOW");
  return Object.freeze({
    sourceDomainId: domain,
    sourceSampleRateHz: rate,
    window: window2,
    ownedThroughSourceSample,
    availabilityTimeMs,
    observations: Object.freeze(observations)
  });
}
function deliverSynchronously(sink, value) {
  try {
    const returned = sink(value);
    if (returned && typeof returned.then === "function") {
      Promise.resolve(returned).catch(() => {
      });
      fail("ACOUSTIC_PUBLICATION_SINK_MUST_BE_SYNCHRONOUS");
    }
  } catch (error) {
    throw new AcousticAnalysisError("ACOUSTIC_PUBLICATION_SINK_FAILED", { cause: error });
  }
}

// apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime.ts
var SourceAnalysisRuntime = class _SourceAnalysisRuntime {
  constructor(options, adapter) {
    this.options = options;
    this.adapter = adapter;
    this.state = "PREROLL";
    this.ring = new AcousticPcmRing();
    this.regions = [];
    this.diagnostics = [];
    this.active = null;
    this.base = null;
    this.nextSource = 0;
    this.nextRegion = 0;
    this.outstanding = 0;
    this.queuedRegions = /* @__PURE__ */ new Map();
    this.chain = Promise.resolve();
    this.failure = null;
    this.delivering = false;
    this.cleanup = null;
    this.lastClock = -Infinity;
    this.counts = {
      windowsQueued: 0,
      windowsStarted: 0,
      windowsPublished: 0,
      observationsPublished: 0,
      peakOutstanding: 0,
      backpressureFailures: 0,
      regionsStarted: 0,
      regionsDrained: 0
    };
    this.detachWorker = options.worker.onFailure?.((error) => this.failAnalysis(error));
  }
  static async create(options) {
    onlyFields(options, ["sourceDomainId", "sourceSampleRateHz", "coefficientBytes", "worker", "nowAvailabilityMs", "onPublication", "onFailure"]);
    if (!options.sourceDomainId || options.sourceDomainId.length > 192) fail("INVALID_ACOUSTIC_DOMAIN");
    await assertAcousticIdentity();
    const adapter = await QualifiedSourceAdapter.create(options.sourceSampleRateHz, options.coefficientBytes);
    return new _SourceAnalysisRuntime(Object.freeze({ ...options, coefficientBytes: new Uint8Array() }), adapter);
  }
  append(block) {
    this.guard();
    try {
      onlyFields(block, ["sourceSampleRateHz", "sourceStartSampleIndex", "sourceEndSampleIndex", "samples"]);
      safeIndex(block.sourceStartSampleIndex);
      safeIndex(block.sourceEndSampleIndex);
      if (block.sourceSampleRateHz !== this.adapter.rate || !(block.samples instanceof Float32Array) || block.samples.length > ACOUSTIC_RESOURCES.maxSourceBlockSamples || block.samples.length !== block.sourceEndSampleIndex - block.sourceStartSampleIndex || block.samples.some((v) => !Number.isFinite(v))) fail("INVALID_ACOUSTIC_CAPTURE_BLOCK");
      if (this.base === null) {
        this.base = block.sourceStartSampleIndex;
        this.nextSource = this.base;
      }
      if (block.sourceStartSampleIndex !== this.nextSource) fail("NONCHRONOLOGICAL_ACOUSTIC_SOURCE");
      this.nextSource = block.sourceEndSampleIndex;
      this.ring.append(this.adapter.push(block.samples));
      this.planAvailable();
    } catch (error) {
      this.failAnalysis(error);
      throw error;
    }
  }
  beginAnalysisRegion(sourceSampleIndex) {
    this.guard();
    try {
      safeIndex(sourceSampleIndex);
      if (!["PREROLL", "IDLE"].includes(this.state) || this.base === null || this.active || sourceSampleIndex !== this.nextSource) fail("INVALID_ACOUSTIC_REGION_START");
      if (this.regions.length >= ACOUSTIC_RESOURCES.maxPendingSegments) fail("ACOUSTIC_SEGMENT_LIMIT_EXCEEDED");
      const originTarget = (sourceSampleIndex - this.base) * 16e3 / this.adapter.rate;
      const region = { index: this.nextRegion++, sourceStart: sourceSampleIndex, originTarget, nextWindow: 0, queuedEndTarget: originTarget };
      if (planWindow(region, this.counts.windowsQueued).startSample < Math.max(10, this.ring.firstRetained)) fail("ACOUSTIC_PREROLL_NOT_READY");
      this.regions.push(region);
      this.active = region;
      this.state = "RUNNING";
      this.counts.regionsStarted++;
      return region.index;
    } catch (error) {
      this.failAnalysis(error);
      throw error;
    }
  }
  endAnalysisRegion(sourceSampleIndex) {
    this.guard();
    try {
      safeIndex(sourceSampleIndex);
      if (!this.active || this.state !== "RUNNING" || sourceSampleIndex !== this.nextSource) fail("ACOUSTIC_REGION_NOT_RUNNING");
      const endTarget = this.active.originTarget + (sourceSampleIndex - this.active.sourceStart) * 16e3 / this.adapter.rate;
      if (endTarget < this.active.queuedEndTarget) fail("ACOUSTIC_REGION_END_MISMATCH");
      this.active.sourceEnd = sourceSampleIndex;
      this.active.endTarget = endTarget;
      this.active = null;
      this.state = "IDLE";
      this.planAvailable();
    } catch (error) {
      this.failAnalysis(error);
      throw error;
    }
  }
  finishRegions() {
    this.guard();
    if (this.active) this.endAnalysisRegion(this.nextSource);
    this.state = "DRAINING";
    this.planAvailable();
  }
  get tailReady() {
    return this.state === "DRAINING" && this.regions.length === 0;
  }
  hasRegionWork(index) {
    return this.regions.some((r) => r.index === index) || this.queuedRegions.has(index);
  }
  get prerollReady() {
    if (!["PREROLL", "IDLE"].includes(this.state) || this.base === null || this.failure) return false;
    return (this.nextSource - this.base) * 16e3 / this.adapter.rate - (ACOUSTIC_MODEL.inputMs - ACOUSTIC_MODEL.futureMs) * 16 >= Math.max(10, this.ring.firstRetained);
  }
  attachCaptureCleanup(cleanup) {
    this.guard();
    if (this.cleanup) fail("ACOUSTIC_CAPTURE_ALREADY_ATTACHED");
    this.cleanup = cleanup;
    return () => {
      this.cleanup = null;
    };
  }
  async drain() {
    await this.chain;
    this.guard();
  }
  async seal() {
    this.guard();
    if (!this.tailReady) fail("REAL_ACOUSTIC_TAIL_REQUIRED");
    await this.drain();
    this.state = "SEALED";
  }
  failAnalysis(error) {
    if (this.delivering) fail("ACOUSTIC_PUBLICATION_REENTRANCY");
    if (this.failure || this.state === "DISPOSED" || this.state === "SEALED") return;
    this.failure = error instanceof Error ? error : new AcousticAnalysisError(String(error));
    this.state = "FAILED";
    this.regions.length = 0;
    this.active = null;
    try {
      this.cleanup?.();
    } catch {
    }
    try {
      this.options.onFailure?.(this.failure);
    } catch {
    }
  }
  async dispose() {
    if (this.delivering) fail("ACOUSTIC_PUBLICATION_REENTRANCY");
    if (this.state === "DISPOSED") return;
    this.state = "DISPOSED";
    this.regions.length = 0;
    this.active = null;
    this.cleanup?.();
    this.cleanup = null;
    this.detachWorker?.();
    this.detachWorker = void 0;
    await this.options.worker.dispose();
    await this.chain;
  }
  snapshot() {
    return Object.freeze({
      state: this.state,
      failureCode: this.failure?.message ?? null,
      acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256,
      sourceAdapterIdentitySha256: this.adapter.identitySha256,
      sourceRateHz: this.adapter.rate,
      sourceBase: this.base,
      nextSourceSampleIndex: this.nextSource,
      activeRegion: this.active ? Object.freeze({ ...this.active }) : null,
      pendingRegions: this.regions.length,
      outstanding: this.outstanding,
      counts: Object.freeze({ ...this.counts }),
      diagnostics: Object.freeze([...this.diagnostics]),
      resources: Object.freeze({
        sessionPcmBytes: 0,
        sourceAdapterBytes: this.adapter.storageBytes(),
        targetRingBytes: ACOUSTIC_RESOURCES.targetRingSamples * 4,
        outstandingInputBytes: this.outstanding * ACOUSTIC_RESOURCES.inputBytes,
        maximumOutstandingInputBytes: 4 * ACOUSTIC_RESOURCES.inputBytes,
        retainedPublicationEvents: 0,
        diagnosticWindowLimit: ACOUSTIC_RESOURCES.diagnosticWindows,
        compactDiagnosticsPlanningBytes: ACOUSTIC_RESOURCES.diagnosticWindows * 512
      })
    });
  }
  guard() {
    if (this.delivering) fail("ACOUSTIC_PUBLICATION_REENTRANCY");
    if (this.failure) throw this.failure;
    if (this.state === "SEALED" || this.state === "DISPOSED") fail("ACOUSTIC_RUNTIME_CLOSED");
  }
  clock() {
    const time = this.options.nowAvailabilityMs();
    if (!Number.isFinite(time) || time < this.lastClock) fail("NONMONOTONIC_ACOUSTIC_AVAILABILITY");
    this.lastClock = time;
    return time;
  }
  planAvailable() {
    for (const region of [...this.regions]) while (true) {
      const window2 = planWindow(region, this.counts.windowsQueued);
      if (!window2) {
        this.regions.shift();
        this.counts.regionsDrained++;
        break;
      }
      if (window2.endSample > this.ring.length) return;
      if (this.outstanding === ACOUSTIC_RESOURCES.maxOutstandingWindows) {
        this.counts.backpressureFailures++;
        fail("ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED");
      }
      const pcm = this.ring.extract(window2.startSample, window2.endSample);
      region.nextWindow++;
      region.queuedEndTarget = window2.ownedEndTarget;
      this.enqueue(window2, pcm);
    }
  }
  enqueue(window2, pcm) {
    const queued = this.clock(), depth = ++this.outstanding;
    this.queuedRegions.set(window2.regionIndex, (this.queuedRegions.get(window2.regionIndex) ?? 0) + 1);
    this.counts.windowsQueued++;
    this.counts.peakOutstanding = Math.max(this.counts.peakOutstanding, depth);
    this.chain = this.chain.then(async () => {
      try {
        if (this.closed()) return;
        const started = this.clock();
        this.counts.windowsStarted++;
        const result = await this.options.worker.run({ window: window2, pcm });
        if (this.closed()) return;
        const available = this.clock(), publication = sourcePublication(this.options.sourceDomainId, this.adapter.rate, this.base, window2, result, available);
        this.delivering = true;
        try {
          deliverSynchronously(this.options.onPublication, publication);
        } finally {
          this.delivering = false;
        }
        const delivered = this.clock();
        this.counts.windowsPublished++;
        this.counts.observationsPublished += publication.observations.length;
        retainCompact(this.diagnostics, Object.freeze({
          jobIndex: window2.jobIndex,
          regionIndex: window2.regionIndex,
          ownedStartTarget: window2.ownedStartTarget,
          ownedEndTarget: window2.ownedEndTarget,
          inputStartSample: window2.startSample,
          inputEndSample: window2.endSample,
          queueDelayMs: started - queued,
          inferenceMs: result.inferenceMs,
          decodeMs: result.decodeMs,
          publicationMs: delivered - available,
          eventCount: publication.observations.length,
          outstandingAtEnqueue: depth,
          actualSessionRunCount: result.actualSessionRunCount
        }));
      } catch (error) {
        this.failAnalysis(error);
      } finally {
        this.outstanding--;
        const remaining = this.queuedRegions.get(window2.regionIndex) - 1;
        if (remaining) this.queuedRegions.set(window2.regionIndex, remaining);
        else this.queuedRegions.delete(window2.regionIndex);
      }
    });
  }
  closed() {
    return this.failure !== null || this.state === "DISPOSED";
  }
};

// apps/customer-web/src/lib/practice/local-core/timebase.ts
var PracticeTimebase = class {
  constructor(options, sampleRateHz) {
    if (typeof options === "string") {
      this.domainId = options;
      this.runtimeOriginMs = 0;
      this.sampleRateHz = sampleRateHz;
      this.anchorSampleIndex = 0;
      this.anchorSessionTimeMs = 0;
      return;
    }
    this.domainId = options.domainId;
    this.runtimeOriginMs = options.runtimeOriginMs ?? 0;
    this.sampleRateHz = options.sampleRateHz;
    this.anchorSampleIndex = options.anchorSampleIndex ?? 0;
    this.anchorSessionTimeMs = options.anchorSessionTimeMs ?? 0;
  }
  atSessionMs(ms, sampleIndex) {
    if (!Number.isFinite(ms)) {
      throw new Error("Session time values must be finite.");
    }
    return sampleIndex === void 0 ? { domainId: this.domainId, ms } : { domainId: this.domainId, ms, sampleIndex };
  }
  runtimeToSessionTime(runtimeMs) {
    return this.atSessionMs(runtimeMs - this.runtimeOriginMs);
  }
  sampleIndexToSessionTime(sampleIndex) {
    if (!this.sampleRateHz || this.sampleRateHz <= 0) {
      throw new Error("Sample-index time conversion requires a positive sample rate.");
    }
    return this.atSessionMs(
      this.anchorSessionTimeMs + (sampleIndex - this.anchorSampleIndex) / this.sampleRateHz * 1e3,
      sampleIndex
    );
  }
  midiEventToSessionTime(midiEventTimeMs) {
    return this.runtimeToSessionTime(midiEventTimeMs);
  }
  assertSameSessionTimeDomain(left, right) {
    if (!Number.isFinite(left.ms) || !Number.isFinite(right.ms)) {
      throw new Error("Session time values must be finite before comparison.");
    }
    if (left.domainId !== right.domainId) {
      throw new Error("Session time values belong to different practice time domains.");
    }
  }
};

// apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler.ts
var STEP_ACOUSTIC_GESTURE_MS = 50;
var MAX_STEP_ACOUSTIC_IDENTITIES = 1e5;
var MAX_GESTURE_OBSERVATIONS = 32768;
var order = (a, b) => a.sourceEventSample - b.sourceEventSample || (a.observationId < b.observationId ? -1 : a.observationId === b.observationId ? 0 : 1);
var fingerprint = (o) => JSON.stringify([
  o.observationId,
  o.pitch,
  o.midiPitch,
  o.confidence,
  o.sourceDomainId,
  o.sourceSampleRateHz,
  o.sourceEventSample,
  o.targetSample
]);
var validSample = (sample) => Number.isFinite(sample) && sample >= 0 && sample <= Number.MAX_SAFE_INTEGER;
var StepAcousticAttemptAssembler = class {
  constructor(options) {
    this.phase = "BLOCKED";
    this.active = null;
    this.eligibleAfter = null;
    this.frontier = null;
    this.lastWindow = null;
    this.processing = false;
    this.seen = /* @__PURE__ */ new Map();
    if (!options.sourceDomainId || options.sourceDomainId.length > 192 || !options.localSessionId || ![44100, 48e3].includes(options.sourceSampleRateHz) || !validSample(options.sourceAnchorSample) || options.sessionAnchorTime.domainId !== options.localSessionId || !Number.isFinite(options.sessionAnchorTime.ms)) {
      throw new Error("STEP_ACOUSTIC_SOURCE_MAPPING_INVALID");
    }
    this.sourceDomainId = options.sourceDomainId;
    this.sourceRate = options.sourceSampleRateHz;
    this.sink = Object.freeze({ ...options.sink });
    this.timebase = new PracticeTimebase({
      domainId: options.localSessionId,
      sampleRateHz: this.sourceRate,
      anchorSampleIndex: options.sourceAnchorSample,
      anchorSessionTimeMs: options.sessionAnchorTime.ms
    });
  }
  /** External owner calls only after its explicit retirement/READY commit. This does not rearm the domain. */
  acceptInputAfter(sourceWatermark) {
    this.guard();
    if (this.active || !validSample(sourceWatermark) || this.eligibleAfter !== null && sourceWatermark < this.eligibleAfter || this.frontier !== null && sourceWatermark < this.frontier) this.fail("STEP_ACOUSTIC_RETIREMENT_INVALID");
    this.eligibleAfter = sourceWatermark;
    this.phase = "READY";
  }
  /** Unfinished ownership is invalidated, not queued. Caller separately cancels its domain attempt. */
  suspend() {
    this.guard();
    this.active = null;
    this.phase = "BLOCKED";
  }
  accept(publication) {
    this.guard();
    this.processing = true;
    try {
      if (publication.sourceDomainId !== this.sourceDomainId || publication.sourceSampleRateHz !== this.sourceRate || !validSample(publication.ownedThroughSourceSample) || publication.observations.length > MAX_GESTURE_OBSERVATIONS) {
        this.fail("STEP_ACOUSTIC_PUBLICATION_INVALID");
      }
      const previousFrontier = this.frontier;
      if (this.active && previousFrontier !== null && publication.ownedThroughSourceSample > previousFrontier && this.lastWindow && (publication.window.regionIndex !== this.lastWindow.region || publication.window.windowIndex > this.lastWindow.index + 1)) {
        this.fail("STEP_ACOUSTIC_GESTURE_COVERAGE_GAP");
      }
      const observations = [...publication.observations].sort(order), fresh = /* @__PURE__ */ new Set();
      for (const o of observations) {
        if (Object.keys(o).length !== 8 || o.sourceDomainId !== this.sourceDomainId || o.sourceSampleRateHz !== this.sourceRate || !o.observationId || o.observationId.length > 512 || !validSample(o.sourceEventSample) || !Number.isSafeInteger(o.targetSample) || o.sourceEventSample >= publication.ownedThroughSourceSample || !Number.isInteger(o.midiPitch) || o.midiPitch < 21 || o.midiPitch > 108 || !/^[A-G]#?-?\d$/.test(o.pitch) || !Number.isFinite(o.confidence) || o.confidence < 0 || o.confidence > 1) this.fail("STEP_ACOUSTIC_OBSERVATION_INVALID");
        const value = fingerprint(o), old = this.seen.get(o.observationId);
        if (old !== void 0 && old !== value) this.fail("STEP_ACOUSTIC_MUTATED_OBSERVATION");
        if (old === void 0) {
          if (this.seen.size === MAX_STEP_ACOUSTIC_IDENTITIES) this.fail("STEP_ACOUSTIC_IDENTITY_LIMIT");
          if (this.phase !== "BLOCKED" && this.eligibleAfter !== null && o.sourceEventSample > this.eligibleAfter && previousFrontier !== null && o.sourceEventSample < previousFrontier) this.fail("STEP_ACOUSTIC_NONCHRONOLOGICAL_OBSERVATION");
          this.seen.set(o.observationId, value);
          fresh.add(o.observationId);
        }
      }
      this.frontier = Math.max(previousFrontier ?? 0, publication.ownedThroughSourceSample);
      if (previousFrontier === null || publication.ownedThroughSourceSample > previousFrontier) {
        this.lastWindow = Object.freeze({ region: publication.window.regionIndex, index: publication.window.windowIndex });
      }
      if (this.phase === "READY") {
        const first = observations.find((o) => fresh.has(o.observationId) && o.sourceEventSample > this.eligibleAfter);
        if (first) {
          const identity = this.sink.open(this.timebase.sampleIndexToSessionTime(first.sourceEventSample));
          this.assertCallbackDidNotFail();
          if (identity === null) {
            this.phase = "BLOCKED";
            return null;
          }
          const end = first.sourceEventSample + this.sourceRate * STEP_ACOUSTIC_GESTURE_MS / 1e3;
          if (!validSample(end)) this.fail("STEP_ACOUSTIC_INTERVAL_INVALID");
          this.active = { identity, anchor: first.sourceEventSample, end, observations: /* @__PURE__ */ new Map() };
          this.phase = "CAPTURING";
        }
      }
      if (!this.active) return null;
      const active = this.active;
      for (const o of observations) if (o.sourceEventSample >= active.anchor && o.sourceEventSample < active.end && (fresh.has(o.observationId) || active.observations.has(o.observationId))) {
        active.observations.set(o.observationId, Object.freeze({ ...o }));
        if (active.observations.size > MAX_GESTURE_OBSERVATIONS) this.fail("STEP_ACOUSTIC_GESTURE_LIMIT");
      }
      if (this.frontier < active.end) return null;
      if (!active.observations.size) this.fail("STEP_ACOUSTIC_EMPTY_GESTURE");
      const bounded = Object.freeze([...active.observations.values()].sort(order));
      const evidence = Object.freeze({
        kind: "EVIDENCE",
        observedAttackPitches: Object.freeze([...new Set(bounded.map((o) => o.pitch))].sort()),
        confidence: Math.min(...bounded.map((o) => o.confidence)),
        captureEndSessionTime: Object.freeze(this.timebase.sampleIndexToSessionTime(active.end))
      });
      const sealed = Object.freeze({
        sourceDomainId: this.sourceDomainId,
        sourceSampleRateHz: this.sourceRate,
        anchorSourceSample: active.anchor,
        endSourceSample: active.end,
        observations: bounded,
        evidence
      });
      this.active = null;
      this.phase = "BLOCKED";
      this.sink.complete(active.identity, evidence);
      this.assertCallbackDidNotFail();
      return sealed;
    } catch (error) {
      this.active = null;
      this.phase = "FAILED";
      throw error;
    } finally {
      this.processing = false;
    }
  }
  snapshot() {
    return Object.freeze({
      phase: this.phase,
      inputEligibleAfterSourceSample: this.eligibleAfter,
      processedThroughSourceSample: this.frontier,
      gestureAnchorSourceSample: this.active?.anchor ?? null,
      gestureEndSourceSample: this.active?.end ?? null,
      activeObservationCount: this.active?.observations.size ?? 0,
      retainedObservationIdentityCount: this.seen.size
    });
  }
  guard() {
    if (this.processing || this.phase === "FAILED") this.fail("STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE");
  }
  assertCallbackDidNotFail() {
    if (this.phase === "FAILED") this.fail("STEP_ACOUSTIC_ASSEMBLER_UNAVAILABLE");
  }
  fail(code) {
    this.active = null;
    this.phase = "FAILED";
    throw new Error(code);
  }
};

// apps/customer-web/src/lib/practice/acoustic/source/source-chronology.ts
var SourceChronology = class {
  constructor(rate) {
    this.rate = rate;
    this.nextSequence = 0;
    this.nextSource = 0;
    this.origin = null;
    this.sizes = {};
  }
  accept(chunk) {
    onlyFields(chunk, [
      "type",
      "sequence",
      "sourceSampleRateHz",
      "sourceStartSampleIndex",
      "sourceEndSampleIndex",
      "audioContextStartFrame",
      "inputChannelCount",
      "captureTimeSeconds",
      "samples"
    ]);
    safeIndex(chunk.audioContextStartFrame);
    safeIndex(chunk.sourceStartSampleIndex);
    safeIndex(chunk.sourceEndSampleIndex);
    if (chunk.type !== "pcm-chunk" || chunk.sequence !== this.nextSequence || chunk.sourceSampleRateHz !== this.rate || chunk.sourceStartSampleIndex !== this.nextSource || !(chunk.samples instanceof Float32Array) || chunk.samples.length <= 0 || chunk.samples.length > ACOUSTIC_RESOURCES.maxSourceBlockSamples || chunk.sourceEndSampleIndex - chunk.sourceStartSampleIndex !== chunk.samples.length || !Number.isInteger(chunk.inputChannelCount) || chunk.inputChannelCount < 1 || !Number.isFinite(chunk.captureTimeSeconds) || Math.abs(chunk.captureTimeSeconds - chunk.audioContextStartFrame / this.rate) > 1e-5) fail("CAPTURE_CHRONOLOGY_VIOLATION");
    const origin = chunk.audioContextStartFrame - chunk.sourceStartSampleIndex;
    if (this.origin !== null && origin !== this.origin) fail("CAPTURE_CONTEXT_FRAME_GAP");
    this.origin = origin;
    this.nextSource = chunk.sourceEndSampleIndex;
    this.nextSequence++;
    const key = String(chunk.samples.length);
    if (key in this.sizes || Object.keys(this.sizes).length < 32) this.sizes[key] = (this.sizes[key] ?? 0) + 1;
    else this.sizes.OTHER = (this.sizes.OTHER ?? 0) + 1;
  }
  snapshot() {
    return Object.freeze({
      nextSequence: this.nextSequence,
      audioContextOriginFrame: this.origin,
      blocks: this.nextSequence,
      chunkSizes: Object.freeze({ ...this.sizes })
    });
  }
};

// apps/customer-web/src/lib/practice/step/step-acoustic-capture-bridge.ts
var StepAcousticCaptureBridge = class {
  constructor(runtime, rate, accepted, onFailure) {
    this.runtime = runtime;
    this.rate = rate;
    this.accepted = accepted;
    this.onFailure = onFailure;
    this.capturedThrough = 0;
    this.closed = false;
    this.receiving = false;
    this.failure = null;
    this.cleanup = null;
    this.chronology = new SourceChronology(rate);
  }
  receive(chunk) {
    try {
      if (this.closed || this.receiving) throw new Error("STEP_CAPTURE_CLOSED_OR_REENTRANT");
      this.receiving = true;
      this.chronology.accept(chunk);
      this.runtime.append({
        sourceSampleRateHz: chunk.sourceSampleRateHz,
        sourceStartSampleIndex: chunk.sourceStartSampleIndex,
        sourceEndSampleIndex: chunk.sourceEndSampleIndex,
        samples: chunk.samples
      });
      this.capturedThrough = chunk.sourceEndSampleIndex;
      this.accepted();
      if (this.closed) throw this.failure ?? new Error("STEP_CAPTURE_CLOSED_DURING_ACCEPT");
    } catch (error) {
      this.abort(error);
      throw error;
    } finally {
      this.receiving = false;
    }
  }
  attachCaptureCleanup(cleanup) {
    if (this.closed || this.cleanup) {
      cleanup();
      const error = new Error("STEP_CAPTURE_CLEANUP_UNAVAILABLE");
      this.abort(error);
      throw error;
    }
    this.cleanup = cleanup;
    return () => {
      if (this.cleanup === cleanup) this.cleanup = null;
    };
  }
  abort(error) {
    if (this.failure || this.closed) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.dispose();
    this.onFailure(this.failure);
  }
  dispose() {
    if (this.closed) return;
    this.closed = true;
    const cleanup = this.cleanup;
    this.cleanup = null;
    try {
      cleanup?.();
    } catch {
    }
  }
  snapshot() {
    return Object.freeze({
      sourceSampleRateHz: this.rate,
      capturedThroughSourceSample: this.capturedThrough,
      ...this.chronology.snapshot(),
      closed: this.closed,
      failure: this.failure?.message ?? null
    });
  }
};

// apps/customer-web/src/lib/practice/step/step-microphone-input.ts
var StepMicrophoneInput = class {
  constructor(platform, sink) {
    this.platform = platform;
    this.sink = sink;
    this.state = "NEW";
    this.connection = null;
    this.worker = null;
    this.runtime = null;
    this.bridge = null;
    this.assembler = null;
    this.timebase = null;
    this.capture = null;
    this.setupTask = null;
    this.disposal = null;
    this.failure = null;
    this.captureConnected = false;
    this.delivering = false;
    this.regionStarted = false;
    this.publications = 0;
    this.sequence = 0;
    this.issued = null;
    this.retiredThrough = -1;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.clock = Object.freeze({ nowMs: () => {
      if (!this.connection) throw new Error("STEP_MICROPHONE_CONTEXT_NOT_ATTACHED");
      return this.connection.context.currentTime * 1e3;
    } });
    this.contextChanged = () => {
      if (this.connection?.context.state !== "running") this.fail(new Error("STEP_MICROPHONE_CONTEXT_INTERRUPTED"));
    };
    void this.ready.catch(() => {
    });
  }
  start(connection, signal) {
    if (this.state !== "NEW") return Promise.reject(new Error("STEP_MICROPHONE_START_ONCE"));
    this.state = "PREPARING";
    this.connection = Object.freeze({ ...connection });
    const aborted = () => this.fail(new Error("STEP_MICROPHONE_ABORTED"));
    signal.addEventListener("abort", aborted, { once: true });
    this.detachSignal = () => signal.removeEventListener("abort", aborted);
    connection.context.addEventListener("statechange", this.contextChanged);
    this.setupTask = this.setup(signal);
    return this.setupTask.then(async () => {
      this.check();
      this.captureConnected = true;
      this.maybeReady();
      await this.ready;
      this.check();
      return this.retirementBoundary();
    }).catch((error) => {
      this.fail(error);
      throw error;
    });
  }
  /** An issued physical fact, not a caller-provided timestamp or acoustic processed frontier. */
  retirementBoundary() {
    try {
      this.check();
      if (this.delivering || this.state !== "AVAILABLE" || this.assembler?.snapshot().phase !== "BLOCKED") {
        throw new Error("STEP_MICROPHONE_RETIREMENT_NOT_AVAILABLE");
      }
      const capture = this.bridge.snapshot(), sample = capture.capturedThroughSourceSample;
      if (!Number.isSafeInteger(sample) || sample < this.retiredThrough) throw new Error("STEP_MICROPHONE_RETIREMENT_INVALID");
      this.issued = Object.freeze({
        sourceDomainId: this.connection.sourceDomainId,
        sourceSampleRateHz: capture.sourceSampleRateHz,
        capturedThroughSourceSample: sample,
        sessionTime: Object.freeze(this.timebase.sampleIndexToSessionTime(sample)),
        sequence: ++this.sequence
      });
      return this.issued;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  /** Call synchronously after the application's domain retirement commit. Failure is terminal, never rollback. */
  arm(boundary) {
    try {
      this.check();
      const capture = this.bridge.snapshot();
      if (this.delivering || this.state !== "AVAILABLE" || boundary !== this.issued || boundary.sourceDomainId !== this.connection.sourceDomainId || boundary.sourceSampleRateHz !== capture.sourceSampleRateHz || boundary.capturedThroughSourceSample !== capture.capturedThroughSourceSample || boundary.capturedThroughSourceSample < this.retiredThrough || boundary.sessionTime.domainId !== this.connection.localSessionId || boundary.sessionTime.sampleIndex !== boundary.capturedThroughSourceSample || boundary.sessionTime.ms !== this.timebase.sampleIndexToSessionTime(boundary.capturedThroughSourceSample).ms) {
        throw new Error("STEP_MICROPHONE_RETIREMENT_INVALID");
      }
      this.assembler.acceptInputAfter(boundary.capturedThroughSourceSample);
      this.retiredThrough = boundary.capturedThroughSourceSample;
      this.issued = null;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }
  snapshot() {
    return Object.freeze({
      resourceState: this.state,
      failure: this.failure?.message ?? null,
      publications: this.publications,
      retiredThroughSourceSample: this.retiredThrough,
      retirementSequence: this.sequence,
      regionStarted: this.regionStarted,
      capture: this.bridge?.snapshot() ?? null,
      analysis: this.runtime?.snapshot() ?? null,
      assembler: this.assembler?.snapshot() ?? null
    });
  }
  dispose() {
    if (this.disposal) return this.disposal;
    if (!this.failure) this.state = "DISPOSED";
    this.rejectReady(new Error("STEP_MICROPHONE_DISPOSED"));
    this.detachSignal?.();
    this.detachSignal = void 0;
    this.connection?.context.removeEventListener("statechange", this.contextChanged);
    this.bridge?.dispose();
    try {
      this.assembler?.suspend();
    } catch {
    }
    this.disposal = Promise.resolve().then(async () => {
      try {
        await this.setupTask;
      } catch {
      }
      this.capture?.stop();
      this.detachWorker?.();
      this.detachWorker = void 0;
      if (this.runtime) await this.runtime.dispose();
      else await this.worker?.dispose();
    });
    void this.disposal.catch((error) => this.fail(error));
    return this.disposal;
  }
  async setup(signal) {
    const c = this.connection;
    if (signal.aborted || c.context.state !== "running" || ![44100, 48e3].includes(c.context.sampleRate) || !c.localSessionId || !c.sourceDomainId || c.sourceDomainId.length > 192) throw new Error("STEP_MICROPHONE_CONNECTION_INVALID");
    const url = await this.platform.modelUrl(signal);
    this.check();
    this.worker = this.platform.createWorker();
    this.detachWorker = this.worker.onFailure?.((error) => this.fail(error));
    await this.worker.load(url);
    this.check();
    const coefficientBytes = await this.platform.coefficients(c.context.sampleRate);
    this.check();
    this.runtime = await SourceAnalysisRuntime.create({
      sourceDomainId: c.sourceDomainId,
      sourceSampleRateHz: c.context.sampleRate,
      coefficientBytes,
      worker: { run: (input) => this.worker.run(input), dispose: () => this.worker.dispose() },
      nowAvailabilityMs: () => c.context.currentTime * 1e3,
      onPublication: (publication) => this.publication(publication),
      onFailure: (error) => this.fail(error)
    });
    this.check();
    this.bridge = new StepAcousticCaptureBridge(
      this.runtime,
      c.context.sampleRate,
      () => this.captured(),
      (error) => this.fail(error)
    );
    this.capture = await this.platform.connectCapture({
      bridge: this.bridge,
      stream: c.stream,
      ownership: "BORROWED_SESSION_STREAM",
      context: c.context,
      workletUrl: this.platform.workletUrl
    });
    if (this.closed()) this.capture.stop();
    this.check();
  }
  captured() {
    this.check();
    const c = this.connection, capture = this.bridge.snapshot(), origin = capture.audioContextOriginFrame;
    if (origin === null || !Number.isSafeInteger(origin) || origin < 0) throw new Error("STEP_MICROPHONE_SOURCE_MAPPING_INVALID");
    if (!this.assembler) {
      const rate = capture.sourceSampleRateHz;
      this.timebase = new PracticeTimebase({
        domainId: c.localSessionId,
        sampleRateHz: rate,
        anchorSampleIndex: 0,
        anchorSessionTimeMs: origin / rate * 1e3
      });
      this.assembler = new StepAcousticAttemptAssembler({
        sourceDomainId: c.sourceDomainId,
        sourceSampleRateHz: rate,
        localSessionId: c.localSessionId,
        sourceAnchorSample: 0,
        sessionAnchorTime: this.timebase.sampleIndexToSessionTime(0),
        sink: {
          open: (time) => {
            this.check();
            return this.sink.open(time);
          },
          complete: (identity, evidence) => {
            this.check();
            this.sink.complete(identity, evidence);
            this.check();
          }
        }
      });
    }
    if (!this.regionStarted && this.runtime.prerollReady) {
      this.runtime.beginAnalysisRegion(capture.capturedThroughSourceSample);
      this.regionStarted = true;
    }
    this.maybeReady();
  }
  maybeReady() {
    if (this.state === "PREPARING" && this.captureConnected && this.regionStarted && this.assembler) {
      this.state = "AVAILABLE";
      this.resolveReady();
    }
  }
  publication(publication) {
    if (this.closed()) return;
    try {
      if (this.delivering || !this.assembler || !this.bridge || publication.ownedThroughSourceSample > this.bridge.snapshot().capturedThroughSourceSample) {
        throw new Error("STEP_MICROPHONE_PUBLICATION_INVALID");
      }
      this.delivering = true;
      this.assembler.accept(publication);
      this.check();
      this.publications++;
    } catch (error) {
      this.fail(error);
      throw error;
    } finally {
      this.delivering = false;
    }
  }
  closed() {
    return this.state === "FAILED" || this.state === "DISPOSED";
  }
  check() {
    if (this.closed()) throw this.failure ?? new Error("STEP_MICROPHONE_DISPOSED");
  }
  fail(error) {
    if (this.closed()) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.state = "FAILED";
    this.issued = null;
    this.rejectReady(this.failure);
    void this.dispose();
    try {
      this.sink.failure(this.failure);
    } catch {
    }
  }
};

// apps/customer-web/src/lib/auth/return-url.ts
var DEFAULT_LOGIN_PATH = "/auth/login";
var LOCALE_PATTERN = /^\/(zh|en)(\/|$)/;
function getSafeReturnUrl(value, fallback = "/upload") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }
  return value;
}
function getLoginPath(pathname) {
  const localeMatch = pathname.match(LOCALE_PATTERN);
  return localeMatch ? `/${localeMatch[1]}${DEFAULT_LOGIN_PATH}` : DEFAULT_LOGIN_PATH;
}
function withReturnUrl(path, returnUrl) {
  const safeReturnUrl = getSafeReturnUrl(returnUrl, "");
  if (!safeReturnUrl) return path;
  const params = new URLSearchParams({ returnUrl: safeReturnUrl });
  return `${path}?${params.toString()}`;
}
function getLoginHrefForReturnUrl(returnUrl) {
  return withReturnUrl(getLoginPath(returnUrl), returnUrl);
}
function getCurrentPathWithSearch() {
  if (typeof window === "undefined") return "/";
  const { pathname, search } = window.location;
  return `${pathname}${search}`;
}
function getCurrentLoginHref() {
  return getLoginHrefForReturnUrl(getCurrentPathWithSearch());
}

// apps/customer-web/src/lib/app-protocol.ts
var API_BASE_URL = "/api/v1";
var REALTIME_EVENTS_URL = `${API_BASE_URL}/realtime/events`;
var CSRF_COOKIE_NAME = "noteverse_csrf";
var CSRF_HEADER_NAME = "x-csrf-token";

// apps/customer-web/src/lib/observability/client.ts
var activeSink = null;
var SENSITIVE_KEY_PATTERN = /(password|token|secret|cookie|musicxml|xml|content|body|file|image|audio)/i;
function normalizePrimitive(value) {
  if (typeof value === "string" && value.length > 300) {
    return `${value.slice(0, 300)}...`;
  }
  return value;
}
function sanitizeContext(context) {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, "[redacted]"];
      }
      if (Array.isArray(value)) {
        return [key, value.map(normalizePrimitive)];
      }
      return [key, normalizePrimitive(value)];
    })
  );
}
function normalizeError(error) {
  if (error instanceof Error) {
    const digest = "digest" in error && typeof error.digest === "string" ? error.digest : void 0;
    const requestId = "requestId" in error && typeof error.requestId === "string" ? error.requestId : "request_id" in error && typeof error.request_id === "string" ? error.request_id : void 0;
    return {
      name: error.name || "Error",
      message: error.message,
      stack: error.stack,
      digest,
      request_id: requestId
    };
  }
  return {
    name: "NonErrorThrown",
    message: typeof error === "string" ? error : "A non-Error value was thrown."
  };
}
function reportClientError(error, context = {}) {
  activeSink?.captureError(normalizeError(error), sanitizeContext(context));
}

// apps/customer-web/src/lib/api-client.ts
var ApiError = class extends Error {
  constructor(status, code, message, requestId) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.name = "ApiError";
  }
};
function buildHeaders(customHeaders) {
  const headers = new Headers(customHeaders);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}
function getCookie(name) {
  if (typeof document === "undefined") return void 0;
  return document.cookie.split("; ").map((cookie) => cookie.split("=")).find(([key]) => key === name)?.[1];
}
function addCsrfHeader(headers, options) {
  const csrfToken = getCookie(CSRF_COOKIE_NAME);
  if (csrfToken && (options?.overwrite || !headers.has(CSRF_HEADER_NAME))) {
    headers.set(CSRF_HEADER_NAME, decodeURIComponent(csrfToken));
  }
  return headers;
}
function isUnsafeMethod(method) {
  return !["GET", "HEAD", "OPTIONS", "TRACE"].includes((method ?? "GET").toUpperCase());
}
function shouldSkipRefresh(url) {
  return url.endsWith("/auth/refresh") || url.endsWith("/auth/login") || url.endsWith("/auth/register") || url.includes("/auth/email/") || url.includes("/auth/password/");
}
function safeRequestPath(url) {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url.split("?")[0] ?? url;
  }
}
function redirectToLoginIfNeeded(options) {
  if (options?.suppressAuthRedirect || typeof window === "undefined") return;
  const { pathname } = window.location;
  if (pathname.endsWith("/auth/login")) return;
  window.location.href = getCurrentLoginHref();
}
async function readJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
function fallbackErrorCode(status) {
  return status >= 500 ? "internal_error" : "unknown_error";
}
function createApiError(response, data, fallbackCode = fallbackErrorCode(response.status), fallbackMessage = fallbackCode) {
  const publicCode = typeof data.public_code === "string" ? data.public_code : fallbackCode;
  const publicMessage = typeof data.public_message === "string" ? data.public_message : fallbackMessage;
  return new ApiError(
    response.status,
    publicCode,
    publicMessage,
    typeof data.request_id === "string" ? data.request_id : response.headers.get("X-Request-ID") ?? void 0
  );
}
async function handleResponse(response, options) {
  const contentType = response.headers.get("content-type");
  if (response.status === 401) {
    redirectToLoginIfNeeded(options);
  }
  if (contentType && !contentType.includes("application/json")) {
    if (!response.ok) {
      const code = fallbackErrorCode(response.status);
      throw new ApiError(
        response.status,
        code,
        code,
        response.headers.get("X-Request-ID") ?? void 0
      );
    }
    return response;
  }
  const data = await readJsonSafely(response);
  if (!response.ok) {
    throw createApiError(response, data);
  }
  return data;
}
var refreshPromise = null;
async function refreshSession() {
  if (!refreshPromise) {
    const headers = addCsrfHeader(buildHeaders());
    refreshPromise = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers,
      credentials: "include"
    }).then((response) => response.ok).catch(() => false).finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}
async function fetchWithAuthRetry(url, init) {
  if (isUnsafeMethod(init.method) && !getCookie(CSRF_COOKIE_NAME) && !shouldSkipRefresh(url)) {
    await refreshSession();
    if (init.headers instanceof Headers) {
      addCsrfHeader(init.headers, { overwrite: true });
    }
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    reportClientError(error, {
      area: "api_client",
      action: "fetch",
      method: init.method ?? "GET",
      path: safeRequestPath(url)
    });
    throw error;
  }
  if (response.status !== 401 || shouldSkipRefresh(url)) {
    return response;
  }
  const refreshed = await refreshSession();
  if (!refreshed) {
    return response;
  }
  if (init.headers instanceof Headers) {
    addCsrfHeader(init.headers, { overwrite: true });
  }
  return fetch(url, init);
}
function toQueryString(params) {
  if (!params) return "";
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== void 0).map(([key, value]) => [key, String(value)])
  );
  const queryString = query.toString();
  return queryString ? `?${queryString}` : "";
}
async function get(url, params, options) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}${toQueryString(params)}`, {
    method: "GET",
    headers: addCsrfHeader(buildHeaders()),
    credentials: "include",
    signal: options?.signal
  });
  return handleResponse(response, options);
}
async function post(url, data, options) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "POST",
    headers: addCsrfHeader(buildHeaders(options?.headers)),
    body: data ? JSON.stringify(data) : void 0,
    credentials: "include"
  });
  return handleResponse(response, options);
}
async function put(url, data) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "PUT",
    headers: addCsrfHeader(buildHeaders()),
    body: data ? JSON.stringify(data) : void 0,
    credentials: "include"
  });
  return handleResponse(response);
}
async function patch(url, data) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "PATCH",
    headers: addCsrfHeader(buildHeaders()),
    body: data ? JSON.stringify(data) : void 0,
    credentials: "include"
  });
  return handleResponse(response);
}
async function del(url) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "DELETE",
    headers: addCsrfHeader(buildHeaders()),
    credentials: "include"
  });
  return handleResponse(response);
}
async function upload(url, file, fieldName = "file") {
  const formData = new FormData();
  formData.append(fieldName, file);
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "POST",
    headers: addCsrfHeader(new Headers()),
    body: formData,
    credentials: "include"
  });
  return handleResponse(response);
}
async function putBlobToUrl(url, blob, headers) {
  const uploadUrl = url.startsWith("http://") || url.startsWith("https://") ? url : `${API_BASE_URL}${url}`;
  const requestHeaders = new Headers(headers);
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    addCsrfHeader(requestHeaders);
  }
  let response;
  try {
    response = await fetchWithAuthRetry(uploadUrl, {
      method: "PUT",
      headers: requestHeaders,
      body: blob,
      credentials: url.startsWith("http://") || url.startsWith("https://") ? "omit" : "include"
    });
  } catch (error) {
    throw new ApiError(
      0,
      "direct_upload_failed",
      error instanceof Error ? error.message : "direct_upload_failed"
    );
  }
  if (!response.ok) {
    const data = response.headers.get("content-type")?.includes("application/json") ? await readJsonSafely(response) : {};
    throw createApiError(response, data, "direct_upload_failed", "direct_upload_failed");
  }
}
async function download(url, options) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "GET",
    headers: addCsrfHeader(new Headers()),
    credentials: "include",
    signal: options?.signal
  });
  if (response.status === 401) {
    redirectToLoginIfNeeded();
  }
  if (!response.ok) {
    const data = response.headers.get("content-type")?.includes("application/json") ? await readJsonSafely(response) : {};
    throw createApiError(response, data, "file_read_failed", "file_read_failed");
  }
  return response.blob();
}
async function postForm(url, data) {
  const headers = new Headers();
  headers.set("Content-Type", "application/x-www-form-urlencoded");
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "POST",
    headers: addCsrfHeader(headers),
    body: new URLSearchParams(data),
    credentials: "include"
  });
  return handleResponse(response);
}
async function postDownload(url, data) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}`, {
    method: "POST",
    headers: addCsrfHeader(buildHeaders()),
    body: data ? JSON.stringify(data) : void 0,
    credentials: "include"
  });
  if (response.status === 401) {
    redirectToLoginIfNeeded();
  }
  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    const errorData = contentType?.includes("application/json") ? await readJsonSafely(response) : {};
    throw createApiError(
      response,
      errorData,
      fallbackErrorCode(response.status)
    );
  }
  return response;
}
async function getRaw(url, params, options) {
  const response = await fetchWithAuthRetry(`${API_BASE_URL}${url}${toQueryString(params)}`, {
    method: "GET",
    headers: addCsrfHeader(buildHeaders()),
    credentials: "include",
    signal: options?.signal
  });
  if (response.status === 401) {
    redirectToLoginIfNeeded(options);
  }
  if (!response.ok) {
    const contentType = response.headers.get("content-type");
    const errorData = contentType?.includes("application/json") ? await readJsonSafely(response) : {};
    throw createApiError(
      response,
      errorData,
      fallbackErrorCode(response.status)
    );
  }
  return response;
}
var apiClient = {
  get,
  getRaw,
  post,
  postDownload,
  put,
  patch,
  delete: del,
  upload,
  putBlobToUrl,
  download,
  postForm
};

// apps/customer-web/src/lib/api/practice-acoustic-model-asset.ts
function assertPracticeAcousticModelAccess(value) {
  if (!value || typeof value !== "object") throw new Error("INVALID_PRACTICE_ACOUSTIC_MODEL_ACCESS");
  const data = value;
  if (data.schemaVersion !== 1 || data.assetId !== "practice-acoustic-robust-browser" || data.assetVersion !== "v1" || data.expectedByteSize !== ACOUSTIC_MODEL.modelBytes || data.sha256 !== ACOUSTIC_MODEL.modelSha256 || data.mediaType !== "application/octet-stream" || typeof data.downloadUrl !== "string" || !data.downloadUrl.startsWith("https://") || !data.downloadUrlExpiresAt || !(Date.parse(data.downloadUrlExpiresAt) > Date.now())) throw new Error("PRACTICE_ACOUSTIC_MODEL_ACCESS_IDENTITY_MISMATCH");
}
async function getPracticeAcousticModelAccess(signal) {
  const response = await apiClient.get(
    "/model-assets/practice-acoustic-robust-browser-v1/access",
    void 0,
    { signal, suppressAuthRedirect: true }
  );
  assertPracticeAcousticModelAccess(response.data);
  return Object.freeze({ ...response.data });
}

// apps/customer-web/src/lib/practice/acoustic/model/worker-client.ts
var AcousticModelWorker = class {
  constructor(worker) {
    this.worker = worker;
    this.sequence = 0;
    this.state = "EMPTY";
    this.busy = false;
    this.failureListener = null;
    this.pending = /* @__PURE__ */ new Map();
    worker.addEventListener("message", (event) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) {
        this.terminate("UNEXPECTED_WORKER_RESPONSE");
        return;
      }
      this.pending.delete(event.data.id);
      if (event.data.error) pending.reject(new AcousticAnalysisError(event.data.error));
      else pending.resolve(event.data.result);
    });
    worker.addEventListener("error", () => this.terminate("ACOUSTIC_WORKER_CRASH"));
    worker.addEventListener("messageerror", () => this.terminate("ACOUSTIC_WORKER_MESSAGE_ERROR"));
  }
  async load(modelUrl) {
    if (this.state !== "EMPTY" || this.busy) throw new AcousticAnalysisError("ACOUSTIC_WORKER_NOT_EMPTY");
    this.busy = true;
    try {
      const result = await this.send({ type: "LOAD", modelUrl });
      this.state = "READY";
      return result;
    } catch (error) {
      this.terminate();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async run(input) {
    if (this.state !== "READY" || this.busy) throw new AcousticAnalysisError("ACOUSTIC_WORKER_CONCURRENCY_OR_STATE");
    this.busy = true;
    try {
      return await this.send({ type: "INFER", input });
    } catch (error) {
      this.terminate();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async dispose() {
    if (this.state === "CLOSED") return;
    if (this.busy) {
      this.terminate("ACOUSTIC_WORKER_DISPOSED");
      return;
    }
    try {
      await this.send({ type: "DISPOSE" });
    } finally {
      this.terminate();
    }
  }
  terminate(code = "ACOUSTIC_WORKER_TERMINATED") {
    if (this.state === "CLOSED") return;
    this.state = "CLOSED";
    const error = new AcousticAnalysisError(code);
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.worker.terminate();
    if (code !== "ACOUSTIC_WORKER_TERMINATED" && code !== "ACOUSTIC_WORKER_DISPOSED") this.failureListener?.(error);
  }
  onFailure(listener) {
    if (this.failureListener) throw new AcousticAnalysisError("ACOUSTIC_WORKER_ALREADY_OBSERVED");
    this.failureListener = listener;
    return () => {
      this.failureListener = null;
    };
  }
  send(message) {
    if (this.state === "CLOSED") return Promise.reject(new AcousticAnalysisError("ACOUSTIC_WORKER_TERMINATED"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ ...message, id });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }
};
function createAcousticModelWorker() {
  return new AcousticModelWorker(new Worker(new URL("./acoustic-worker.entry.ts", import.meta.url), { type: "module" }));
}

// apps/customer-web/src/lib/practice/acoustic/source/capture-transport-contract.ts
var CAPTURE_TRANSPORT_BLOCK_SAMPLES = 2048;
var CAPTURE_TRANSPORT_READY_TIMEOUT_MS = 1e4;

// apps/customer-web/src/lib/practice/acoustic/source/capture.ts
var BrowserAcousticCapture = class _BrowserAcousticCapture {
  constructor(bridge, stream, context, source, node, gain) {
    this.bridge = bridge;
    this.stream = stream;
    this.context = context;
    this.source = source;
    this.node = node;
    this.gain = gain;
    this.stopped = false;
    this.resolveReady = null;
    this.rejectReady = null;
    this.onStateChange = () => {
      if (!this.stopped && this.context.state !== "running") this.fail(new Error("ACOUSTIC_CONTEXT_SUSPENDED"));
    };
    this.readiness = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readiness.catch(() => {
    });
  }
  static async connect(options) {
    onlyFields(options, ["bridge", "stream", "ownership", "context", "workletUrl"]);
    if (!["BORROWED_SESSION_STREAM", "OWNED_ANALYSIS"].includes(options.ownership)) fail("INVALID_CAPTURE_OWNERSHIP");
    const stream = options.ownership === "BORROWED_SESSION_STREAM" ? options.stream.clone() : options.stream;
    let capture = null;
    let node = null, source = null, gain = null;
    try {
      sourceRate(options.context.sampleRate);
      await options.context.audioWorklet.addModule(options.workletUrl);
      node = new AudioWorkletNode(options.context, "noteverse-practice-pcm");
      source = options.context.createMediaStreamSource(stream);
      gain = options.context.createGain();
      gain.gain.value = 0;
      capture = new _BrowserAcousticCapture(options.bridge, stream, options.context, source, node, gain);
      const owner = capture;
      owner.detachCleanup = options.bridge.attachCaptureCleanup(() => owner.stop());
      node.port.onmessage = (event) => {
        if (owner.stopped) return;
        try {
          if (event.data.type === "capture-failure") throw new Error(event.data.code);
          if (event.data.samples?.length !== CAPTURE_TRANSPORT_BLOCK_SAMPLES) throw new Error("ACOUSTIC_CAPTURE_TRANSPORT_BLOCK_VIOLATION");
          const accepted = options.bridge.receive(event.data);
          if (accepted !== void 0) throw new Error("ACOUSTIC_CAPTURE_ASYNC_CONSUMER");
          if (owner.stopped) throw new Error("ACOUSTIC_CAPTURE_STOPPED_DURING_ACCEPT");
          owner.node.port.postMessage({ type: "ACK", sequence: event.data.sequence });
          owner.resolveReady?.();
          owner.settleReady();
        } catch (error) {
          owner.fail(error);
        }
      };
      node.port.onmessageerror = () => owner.fail(new Error("ACOUSTIC_CAPTURE_MESSAGE_ERROR"));
      node.onprocessorerror = () => owner.fail(new Error("ACOUSTIC_WORKLET_CRASH"));
      options.context.addEventListener("statechange", owner.onStateChange);
      owner.readyTimer = setTimeout(() => owner.fail(new Error("ACOUSTIC_CAPTURE_READINESS_TIMEOUT")), CAPTURE_TRANSPORT_READY_TIMEOUT_MS);
      source.connect(node);
      node.connect(gain);
      gain.connect(options.context.destination);
      await owner.readiness;
      return capture;
    } catch (error) {
      if (capture) capture.fail(error);
      else {
        source?.disconnect();
        node?.disconnect();
        node?.port.close();
        gain?.disconnect();
        for (const track of stream.getTracks()) track.stop();
        options.bridge.abort(error);
      }
      throw error;
    }
  }
  settleReady() {
    clearTimeout(this.readyTimer);
    this.resolveReady = null;
    this.rejectReady = null;
  }
  fail(error) {
    if (this.stopped) return;
    this.rejectReady?.(error instanceof Error ? error : new Error(String(error)));
    this.settleReady();
    try {
      this.bridge.abort(error);
    } finally {
      this.stop();
    }
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.rejectReady?.(new Error("ACOUSTIC_CAPTURE_STOPPED_BEFORE_READY"));
    this.settleReady();
    this.detachCleanup?.();
    this.detachCleanup = void 0;
    this.context.removeEventListener("statechange", this.onStateChange);
    this.node.port.onmessage = null;
    this.node.port.onmessageerror = null;
    try {
      this.node.port.postMessage({ type: "STOP" });
    } catch {
    }
    this.node.port.close();
    this.node.onprocessorerror = null;
    this.source.disconnect();
    this.node.disconnect();
    this.gain.disconnect();
    for (const track of this.stream.getTracks()) track.stop();
  }
};

// apps/customer-web/src/lib/practice/step/step-microphone-platform.ts
var browserStepMicrophonePlatform = {
  modelUrl: async (signal) => (await getPracticeAcousticModelAccess(signal)).downloadUrl,
  createWorker: createAcousticModelWorker,
  workletUrl: new URL("../acoustic/source/capture.worklet.js", import.meta.url).toString(),
  async coefficients(rate) {
    const file = rate === 44100 ? "fir-160-441.f32" : rate === 48e3 ? "fir-1-3.f32" : null;
    if (!file) throw new Error("SOURCE_SAMPLE_RATE_NOT_QUALIFIED");
    const response = await fetch(`/model-assets/practice-acoustic/${file}`);
    if (!response.ok) throw new Error("FIR_ASSET_UNAVAILABLE");
    return new Uint8Array(await response.arrayBuffer());
  },
  connectCapture: (options) => BrowserAcousticCapture.connect(options)
};

// apps/customer-web/src/lib/practice/local-core/artifact.ts
var PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1;
function assertPracticeScoreArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error("PracticeScoreArtifact must be an object");
  }
  const candidate = artifact;
  if (candidate.schemaVersion !== PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported PracticeScoreArtifact schema: ${candidate.schemaVersion}`);
  }
  if (!candidate.scoreId || !candidate.revisionId || !candidate.artifactId) {
    throw new Error("PracticeScoreArtifact requires stable score, revision, and artifact identity.");
  }
  if (!Array.isArray(candidate.scoreTempoSegments)) {
    throw new Error("PracticeScoreArtifact requires scoreTempoSegments array.");
  }
  for (let i = 0; i < candidate.scoreTempoSegments.length; i += 1) {
    const segment = candidate.scoreTempoSegments[i];
    if (!segment || typeof segment !== "object") {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(segment.startBeat) || segment.startBeat < 0) {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid startBeat: ${segment.startBeat}.`);
    }
    if (!Number.isFinite(segment.bpm) || segment.bpm <= 0) {
      throw new Error(`PracticeScoreArtifact scoreTempoSegment at index ${i} has invalid bpm: ${segment.bpm}.`);
    }
    if (i > 0 && segment.startBeat <= candidate.scoreTempoSegments[i - 1].startBeat) {
      throw new Error(
        "PracticeScoreArtifact scoreTempoSegments must be strictly sorted by startBeat ascending without duplicate start beats."
      );
    }
  }
  if (!Array.isArray(candidate.meterSegments)) {
    throw new Error("PracticeScoreArtifact requires meterSegments array.");
  }
  for (let i = 0; i < candidate.meterSegments.length; i += 1) {
    const meter = candidate.meterSegments[i];
    if (!meter || typeof meter !== "object") {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} must be an object.`);
    }
    if (!Number.isFinite(meter.startBeat) || meter.startBeat < 0) {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} has invalid startBeat: ${meter.startBeat}.`);
    }
    if (!Number.isFinite(meter.numerator) || meter.numerator < 1 || !Number.isFinite(meter.denominator) || meter.denominator < 1) {
      throw new Error(`PracticeScoreArtifact meterSegment at index ${i} has invalid time signature.`);
    }
  }
  if (!Array.isArray(candidate.practiceAttackSteps) || !Array.isArray(candidate.expectedPracticeGroups) || candidate.practiceAttackSteps.length !== candidate.expectedPracticeGroups.length) {
    throw new Error("PracticeScoreArtifact requires 1:1 attack steps and expected groups.");
  }
  const validArtifact = candidate;
  validArtifact.practiceAttackSteps.forEach((step, index) => {
    const group = validArtifact.expectedPracticeGroups[index];
    if (roundBeat(step.onsetBeat) !== roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact step/group onset mismatch at index ${index}.`);
    }
    const groupPitches = uniqueSorted(group.pitches);
    const stepPitches = uniqueSorted(step.attackTargets.map((target) => target.pitch));
    const strikePitches = uniqueSorted(group.strikeTargets.map((target) => target.pitch));
    if (groupPitches.join("") !== stepPitches.join("")) {
      throw new Error(`PracticeScoreArtifact step/group attack pitch mismatch at index ${index}.`);
    }
    if (groupPitches.join("") !== strikePitches.join("")) {
      throw new Error(`PracticeScoreArtifact group strike target mismatch at index ${index}.`);
    }
    if (roundBeat(group.canonicalEndBeat) < roundBeat(group.onsetBeat)) {
      throw new Error(`PracticeScoreArtifact group canonical end precedes onset at index ${index}.`);
    }
  });
}
function resolvePracticeScope(artifact, scope) {
  assertPracticeScoreArtifact(artifact);
  if (artifact.expectedPracticeGroups.length === 0) {
    throw new Error("Practice scope requires at least one expected group.");
  }
  const isRange = scope.kind === "RANGE";
  const startIndex = isRange ? groupIndex(artifact, scope.startGroupId) : 0;
  const endIndex = isRange ? groupIndex(artifact, scope.endGroupId) : artifact.expectedPracticeGroups.length - 1;
  if (endIndex < startIndex) {
    throw new Error("Practice scope end must not be before its start.");
  }
  const startGroup = artifact.expectedPracticeGroups[startIndex];
  const endGroup = artifact.expectedPracticeGroups[endIndex];
  if (scope.kind === "RANGE") {
    return {
      kind: "RANGE",
      startGroupId: scope.startGroupId,
      endGroupId: scope.endGroupId,
      startIndex,
      endIndex,
      startBeat: startGroup.onsetBeat,
      terminalBeat: entryGroupEndBeat(artifact, endGroup.groupId)
    };
  }
  return {
    kind: "FULL",
    startIndex,
    endIndex,
    startBeat: startGroup.onsetBeat,
    terminalBeat: artifact.scoreEndBeat
  };
}
function entryGroupEndBeat(artifact, groupId) {
  const group = artifact.expectedPracticeGroups.find((candidate) => candidate.groupId === groupId);
  if (!group) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return roundBeat(group.canonicalEndBeat);
}
function attackPitchesForStep(step) {
  return step.attackTargets.map((target) => target.pitch);
}
function continuationPitchesForStep(step) {
  return Array.from(new Set(step.continuation.map((note) => note.pitch)));
}
function groupIndex(artifact, groupId) {
  const index = artifact.expectedPracticeGroups.findIndex((group) => group.groupId === groupId);
  if (index < 0) {
    throw new Error(`Practice scope target not found: ${groupId}`);
  }
  return index;
}
function uniqueSorted(values) {
  return Array.from(new Set(values)).sort();
}
function roundBeat(value) {
  return Math.round(value * 1e6) / 1e6;
}

// apps/customer-web/src/lib/practice/local-core/evidence.ts
function normalizePitchSet(pitches) {
  return Array.from(new Set(pitches)).sort();
}
function pitchSetsEqual(left, right) {
  return normalizePitchSet(left).join("") === normalizePitchSet(right).join("");
}

// apps/customer-web/src/lib/practice/local-core/session.ts
function createLocalSessionId(prefix = "local-practice") {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${random}`;
}

// apps/customer-web/src/lib/practice/local-core/step-attempt.ts
var MAX_STEP_HISTORY_RECORDS = 1e5;
var STEP_RUNTIME_VERSION = Object.freeze({ schemaVersion: 6, runtimeVersion: "step-source-sensitive-verdict-v6" });
var StepDomainError = class extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = "StepDomainError";
  }
};

// apps/customer-web/src/lib/practice/local-core/step-runtime.ts
var StepPracticeRuntime = class {
  constructor(options) {
    this.options = options;
    this.generation = 1;
    this.status = "ACTIVE";
    this.completed = false;
    this.completionReason = null;
    this.attemptState = "READY";
    this.active = null;
    this.pendingPostVerdict = null;
    this.sequence = 0;
    this.inputAvailable = true;
    this.attempts = [];
    this.skips = [];
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.inputSource = options.inputSource;
    this.resolvedScope = resolvePracticeScope(this.artifact, options.scope);
    this.currentIndex = this.resolvedScope.startIndex;
    this.localSessionId = options.localSessionId ?? createLocalSessionId("step");
    this.timebase = options.timebase ?? new PracticeTimebase({ domainId: this.localSessionId });
    if (this.timebase.domainId !== this.localSessionId) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    this.boundary = this.now();
    this.createdAtMs = this.epoch();
    this.metronomeEnabled = options.metronomeEnabled ?? false;
  }
  currentTarget() {
    const step = this.artifact.practiceAttackSteps[this.currentIndex];
    if (!step || this.completed || this.status !== "ACTIVE") return null;
    return Object.freeze({
      stepId: step.stepId,
      targetGeneration: this.generation,
      inputEligibleAfter: this.boundary,
      attackPitches: Object.freeze(attackPitchesForStep(step)),
      continuationPitches: Object.freeze(continuationPitchesForStep(step))
    });
  }
  openAttempt(start) {
    const target = this.currentTarget();
    if (!target || !this.canAcceptAttempt) return null;
    this.validateTime(start);
    if (start.ms <= this.boundary.ms) return null;
    this.assertHistoryRoom();
    this.active = Object.freeze({
      attemptId: `${this.localSessionId}:attempt:${++this.sequence}`,
      localSessionId: this.localSessionId,
      stepId: target.stepId,
      targetGeneration: this.generation,
      inputSource: this.inputSource,
      attemptStartSessionTime: Object.freeze({ ...start })
    });
    this.attemptState = "CAPTURING";
    return this.active;
  }
  analyzeAttempt(identity) {
    if (!this.owns(identity) || this.attemptState !== "CAPTURING") return false;
    this.attemptState = "ANALYZING";
    return true;
  }
  completeAttempt(identity, evidence) {
    if (!this.owns(identity) || this.attemptState !== "ANALYZING") return Object.freeze({ kind: "REJECTED", reason: "STALE_ATTEMPT" });
    this.validateTime(evidence.captureEndSessionTime);
    if (evidence.captureEndSessionTime.ms < identity.attemptStartSessionTime.ms) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    if (evidence.kind === "EVIDENCE" && (!Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1 || evidence.observedAttackPitches.length > 128 || evidence.observedAttackPitches.some((p) => !/^[A-G]#?-?\d$/.test(p)))) {
      throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    }
    if (evidence.kind === "RETRY" && evidence.reason !== "UNCERTAIN" && evidence.reason !== "TOO_QUIET") throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    const pitches = Object.freeze(evidence.kind === "EVIDENCE" ? normalizePitchSet(evidence.observedAttackPitches) : []);
    const expected = this.currentTarget().attackPitches;
    const verdict = evidence.kind === "RETRY" ? "RETRY" : pitchSetsEqual(pitches, expected) ? "MATCH" : this.verdictPolicy === "MICROPHONE_CONSERVATIVE_TRISTATE" && expected.every((pitch) => pitches.includes(pitch)) ? "RETRY" : "MISMATCH";
    const record = Object.freeze({
      ...this.active,
      verdict,
      observedAttackPitches: pitches,
      confidence: evidence.kind === "EVIDENCE" ? evidence.confidence : null,
      captureEndSessionTime: Object.freeze({ ...evidence.captureEndSessionTime }),
      retryReason: evidence.kind === "RETRY" ? evidence.reason : verdict === "RETRY" ? "UNCERTAIN" : null
    });
    this.attempts.push(record);
    this.active = null;
    this.attemptState = "POST_VERDICT";
    this.pendingPostVerdict = record;
    this.boundary = record.captureEndSessionTime;
    return Object.freeze({ kind: "FINALIZED", record });
  }
  rearm(acceptAfterSessionTime) {
    if (this.status !== "ACTIVE" || !this.inputAvailable || this.attemptState !== "POST_VERDICT" || !this.pendingPostVerdict) throw new StepDomainError("STEP_ATTEMPT_STATE_INVALID");
    this.validateTime(acceptAfterSessionTime);
    if (acceptAfterSessionTime.ms < this.boundary.ms) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    this.boundary = Object.freeze({ ...acceptAfterSessionTime });
    const verdict = this.pendingPostVerdict.verdict;
    this.pendingPostVerdict = null;
    this.attemptState = "READY";
    if (verdict === "MATCH") this.advance();
  }
  cancelAttempt() {
    this.active = null;
    if (this.attemptState !== "POST_VERDICT") this.attemptState = "READY";
  }
  setInputUnavailable() {
    if (this.status !== "ACTIVE") return;
    this.cancelAttempt();
    this.inputAvailable = false;
  }
  acceptInputAfter(capturedThrough) {
    if (this.status !== "ACTIVE" || this.inputAvailable || this.active || this.attemptState !== "READY" && this.attemptState !== "POST_VERDICT") throw new StepDomainError("STEP_ATTEMPT_STATE_INVALID");
    this.validateTime(capturedThrough);
    if (capturedThrough.ms < this.boundary.ms) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
    this.boundary = Object.freeze({ ...capturedThrough });
    this.inputAvailable = true;
  }
  skip() {
    const target = this.currentTarget();
    if (!target || !this.canAcceptAttempt) return false;
    this.assertHistoryRoom();
    this.cancelAttempt();
    const skippedAt = this.now();
    if (skippedAt.ms > this.boundary.ms) this.boundary = skippedAt;
    this.skips.push(Object.freeze({ stepId: target.stepId, targetGeneration: this.generation, sessionTime: skippedAt }));
    this.advance();
    return true;
  }
  end() {
    if (this.status === "ENDED") return;
    this.cancelAttempt();
    this.status = "ENDED";
    this.completionReason = "STOPPED_BY_USER";
  }
  snapshot() {
    return Object.freeze({
      localSessionId: this.localSessionId,
      scoreId: this.artifact.scoreId,
      revisionId: this.artifact.revisionId,
      artifactId: this.artifact.artifactId,
      mode: "STEP_BY_STEP",
      inputSource: this.inputSource,
      practiceScope: Object.freeze({ ...this.options.scope }),
      tempoSelection: Object.freeze({ ...this.options.tempoSelection ?? { mode: "SCORE" } }),
      metronomeEnabled: this.metronomeEnabled,
      runtimeStatus: this.status,
      completionReason: this.completionReason,
      version: STEP_RUNTIME_VERSION,
      createdAtMs: this.createdAtMs,
      updatedAtMs: this.epoch(),
      step: Object.freeze({
        verdictPolicy: this.verdictPolicy,
        currentIndex: this.currentIndex,
        targetGeneration: this.generation,
        inputEligibleAfter: this.boundary,
        inputAvailable: this.inputAvailable,
        completed: this.completed,
        attemptState: this.attemptState,
        activeAttempt: this.active,
        pendingPostVerdict: this.pendingPostVerdict,
        canAcceptAttempt: this.canAcceptAttempt,
        attempts: Object.freeze([...this.attempts]),
        skips: Object.freeze([...this.skips])
      })
    });
  }
  setMetronomeEnabled(enabled) {
    this.metronomeEnabled = enabled;
  }
  get currentStepIndex() {
    return this.currentIndex;
  }
  get currentOnsetBeat() {
    return this.artifact.practiceAttackSteps[this.currentIndex]?.onsetBeat ?? this.resolvedScope.terminalBeat;
  }
  get isCompleted() {
    return this.completed;
  }
  get state() {
    return this.status;
  }
  get verdictPolicy() {
    return this.inputSource === "MIDI" ? "MIDI_EXACT_SET" : "MICROPHONE_CONSERVATIVE_TRISTATE";
  }
  get canAcceptAttempt() {
    return this.status === "ACTIVE" && this.inputAvailable && this.attemptState === "READY" && this.currentTarget() !== null;
  }
  advance() {
    this.currentIndex++;
    this.generation++;
    if (this.currentIndex > this.resolvedScope.endIndex) {
      this.completed = true;
      this.status = "ENDED";
      this.completionReason = "SCOPE_COMPLETED";
    }
  }
  owns(identity) {
    return this.status === "ACTIVE" && this.active !== null && identity.attemptId === this.active.attemptId && identity.localSessionId === this.localSessionId && identity.stepId === this.active.stepId && identity.targetGeneration === this.generation && identity.inputSource === this.inputSource && identity.attemptStartSessionTime.domainId === this.active.attemptStartSessionTime.domainId && identity.attemptStartSessionTime.ms === this.active.attemptStartSessionTime.ms;
  }
  assertHistoryRoom() {
    if (this.attempts.length + this.skips.length >= MAX_STEP_HISTORY_RECORDS) {
      this.end();
      throw new StepDomainError("STEP_HISTORY_LIMIT_EXCEEDED");
    }
  }
  validateTime(time) {
    if (!time || time.domainId !== this.localSessionId || !Number.isFinite(time.ms)) throw new StepDomainError("STEP_ATTEMPT_EVIDENCE_INVALID");
  }
  now() {
    return Object.freeze(this.timebase.runtimeToSessionTime(this.options.clock.nowMs()));
  }
  epoch() {
    return this.options.metadataClock?.nowEpochMs() ?? Date.now();
  }
};

// apps/customer-web/src/lib/practice/acoustic/source/microphone-infrastructure.ts
function watchMicrophoneInfrastructure(stream, context, onLoss) {
  const tracks = stream.getAudioTracks();
  const sourceLost = () => onLoss("MICROPHONE_SOURCE_LOST");
  const contextChanged = () => {
    if (context.state !== "running") onLoss("AUDIO_CONTEXT_INTERRUPTED");
  };
  if (!tracks.length || tracks.some((track) => track.readyState !== "live" || track.muted)) throw new Error("MICROPHONE_SOURCE_LOST");
  if (context.state !== "running") throw new Error("AUDIO_CONTEXT_INTERRUPTED");
  for (const track of tracks) {
    track.addEventListener("ended", sourceLost);
    track.addEventListener("mute", sourceLost);
  }
  context.addEventListener("statechange", contextChanged);
  return () => {
    for (const track of tracks) {
      track.removeEventListener("ended", sourceLost);
      track.removeEventListener("mute", sourceLost);
    }
    context.removeEventListener("statechange", contextChanged);
  };
}

// apps/customer-web/src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json
var canonical_practice_score_artifact_default = {
  artifactId: "practice-score-artifact:ec2262af8d689ffb",
  expectedPracticeGroups: [
    {
      canonicalEndBeat: 1,
      eventIds: [
        "event-0.0-1.0-1-1-p1-m1-e1"
      ],
      expectedNotes: [
        {
          eventId: "event-0.0-1.0-1-1-p1-m1-e1",
          expectedNoteId: "event-0.0-1.0-1-1-p1-m1-e1:n1",
          measureNumbers: [
            "1"
          ],
          pitch: "C4",
          renderNoteId: "n1"
        }
      ],
      groupId: "entry-0.0-05162c611506",
      measureNumbers: [
        "1"
      ],
      onsetBeat: 0,
      pitches: [
        "C4"
      ],
      renderNoteIds: [
        "n1"
      ],
      staffIds: [
        "1"
      ],
      strikeTargets: [
        {
          eventIds: [
            "event-0.0-1.0-1-1-p1-m1-e1"
          ],
          expectedNotes: [
            {
              eventId: "event-0.0-1.0-1-1-p1-m1-e1",
              expectedNoteId: "event-0.0-1.0-1-1-p1-m1-e1:n1",
              measureNumbers: [
                "1"
              ],
              pitch: "C4",
              renderNoteId: "n1"
            }
          ],
          measureNumbers: [
            "1"
          ],
          pitch: "C4",
          renderNoteIds: [
            "n1"
          ],
          strikeId: "entry-0.0-05162c611506:strike:C4"
        }
      ],
      voiceIds: [
        "1"
      ]
    },
    {
      canonicalEndBeat: 2,
      eventIds: [
        "event-1.0-1.0-1-1-p1-m1-e2"
      ],
      expectedNotes: [
        {
          eventId: "event-1.0-1.0-1-1-p1-m1-e2",
          expectedNoteId: "event-1.0-1.0-1-1-p1-m1-e2:n2",
          measureNumbers: [
            "1"
          ],
          pitch: "C4",
          renderNoteId: "n2"
        }
      ],
      groupId: "entry-1.0-57d82a629c08",
      measureNumbers: [
        "1"
      ],
      onsetBeat: 1,
      pitches: [
        "C4"
      ],
      renderNoteIds: [
        "n2"
      ],
      staffIds: [
        "1"
      ],
      strikeTargets: [
        {
          eventIds: [
            "event-1.0-1.0-1-1-p1-m1-e2"
          ],
          expectedNotes: [
            {
              eventId: "event-1.0-1.0-1-1-p1-m1-e2",
              expectedNoteId: "event-1.0-1.0-1-1-p1-m1-e2:n2",
              measureNumbers: [
                "1"
              ],
              pitch: "C4",
              renderNoteId: "n2"
            }
          ],
          measureNumbers: [
            "1"
          ],
          pitch: "C4",
          renderNoteIds: [
            "n2"
          ],
          strikeId: "entry-1.0-57d82a629c08:strike:C4"
        }
      ],
      voiceIds: [
        "1"
      ]
    },
    {
      canonicalEndBeat: 4.5,
      eventIds: [
        "event-2.0-1.0-1-1-p1-m1-e3"
      ],
      expectedNotes: [
        {
          eventId: "event-2.0-1.0-1-1-p1-m1-e3",
          expectedNoteId: "event-2.0-1.0-1-1-p1-m1-e3:n3",
          measureNumbers: [
            "1"
          ],
          pitch: "G4",
          renderNoteId: "n3"
        }
      ],
      groupId: "entry-2.0-1aede64d62ef",
      measureNumbers: [
        "1"
      ],
      onsetBeat: 2,
      pitches: [
        "G4"
      ],
      renderNoteIds: [
        "n3"
      ],
      staffIds: [
        "1"
      ],
      strikeTargets: [
        {
          eventIds: [
            "event-2.0-1.0-1-1-p1-m1-e3"
          ],
          expectedNotes: [
            {
              eventId: "event-2.0-1.0-1-1-p1-m1-e3",
              expectedNoteId: "event-2.0-1.0-1-1-p1-m1-e3:n3",
              measureNumbers: [
                "1"
              ],
              pitch: "G4",
              renderNoteId: "n3"
            }
          ],
          measureNumbers: [
            "1"
          ],
          pitch: "G4",
          renderNoteIds: [
            "n3"
          ],
          strikeId: "entry-2.0-1aede64d62ef:strike:G4"
        }
      ],
      voiceIds: [
        "1"
      ]
    },
    {
      canonicalEndBeat: 4.5,
      eventIds: [
        "event-3.0-1.5-1-2-p1-m2-e2"
      ],
      expectedNotes: [
        {
          eventId: "event-3.0-1.5-1-2-p1-m2-e2",
          expectedNoteId: "event-3.0-1.5-1-2-p1-m2-e2:n5",
          measureNumbers: [
            "2"
          ],
          pitch: "A4",
          renderNoteId: "n5"
        },
        {
          eventId: "event-3.0-1.5-1-2-p1-m2-e2",
          expectedNoteId: "event-3.0-1.5-1-2-p1-m2-e2:n6",
          measureNumbers: [
            "2"
          ],
          pitch: "C5",
          renderNoteId: "n6"
        }
      ],
      groupId: "entry-3.0-c2c1674e1bf7",
      measureNumbers: [
        "2"
      ],
      onsetBeat: 3,
      pitches: [
        "A4",
        "C5"
      ],
      renderNoteIds: [
        "n5",
        "n6"
      ],
      staffIds: [
        "1"
      ],
      strikeTargets: [
        {
          eventIds: [
            "event-3.0-1.5-1-2-p1-m2-e2"
          ],
          expectedNotes: [
            {
              eventId: "event-3.0-1.5-1-2-p1-m2-e2",
              expectedNoteId: "event-3.0-1.5-1-2-p1-m2-e2:n5",
              measureNumbers: [
                "2"
              ],
              pitch: "A4",
              renderNoteId: "n5"
            }
          ],
          measureNumbers: [
            "2"
          ],
          pitch: "A4",
          renderNoteIds: [
            "n5"
          ],
          strikeId: "entry-3.0-c2c1674e1bf7:strike:A4"
        },
        {
          eventIds: [
            "event-3.0-1.5-1-2-p1-m2-e2"
          ],
          expectedNotes: [
            {
              eventId: "event-3.0-1.5-1-2-p1-m2-e2",
              expectedNoteId: "event-3.0-1.5-1-2-p1-m2-e2:n6",
              measureNumbers: [
                "2"
              ],
              pitch: "C5",
              renderNoteId: "n6"
            }
          ],
          measureNumbers: [
            "2"
          ],
          pitch: "C5",
          renderNoteIds: [
            "n6"
          ],
          strikeId: "entry-3.0-c2c1674e1bf7:strike:C5"
        }
      ],
      voiceIds: [
        "2"
      ]
    },
    {
      canonicalEndBeat: 6,
      eventIds: [
        "event-4.5-1.5-1-1-p1-m2-e4"
      ],
      expectedNotes: [
        {
          eventId: "event-4.5-1.5-1-1-p1-m2-e4",
          expectedNoteId: "event-4.5-1.5-1-1-p1-m2-e4:n7",
          measureNumbers: [
            "2"
          ],
          pitch: "D5",
          renderNoteId: "n7"
        }
      ],
      groupId: "entry-4.5-547c4de8e393",
      measureNumbers: [
        "2"
      ],
      onsetBeat: 4.5,
      pitches: [
        "D5"
      ],
      renderNoteIds: [
        "n7"
      ],
      staffIds: [
        "1"
      ],
      strikeTargets: [
        {
          eventIds: [
            "event-4.5-1.5-1-1-p1-m2-e4"
          ],
          expectedNotes: [
            {
              eventId: "event-4.5-1.5-1-1-p1-m2-e4",
              expectedNoteId: "event-4.5-1.5-1-1-p1-m2-e4:n7",
              measureNumbers: [
                "2"
              ],
              pitch: "D5",
              renderNoteId: "n7"
            }
          ],
          measureNumbers: [
            "2"
          ],
          pitch: "D5",
          renderNoteIds: [
            "n7"
          ],
          strikeId: "entry-4.5-547c4de8e393:strike:D5"
        }
      ],
      voiceIds: [
        "1"
      ]
    }
  ],
  firstPlayableBeat: 0,
  meterSegments: [
    {
      countInPulses: 3,
      denominator: 4,
      measureDurationBeats: 3,
      numerator: 3,
      source: "MUSICXML",
      startBeat: 0
    },
    {
      countInPulses: 6,
      denominator: 8,
      measureDurationBeats: 3,
      numerator: 6,
      source: "MUSICXML",
      startBeat: 3
    }
  ],
  playableEvents: [
    {
      durationBeats: 1,
      entryCandidate: true,
      eventId: "event-0.0-1.0-1-1-p1-m1-e1",
      measureNumbers: [
        "1"
      ],
      onsetBeat: 0,
      pitches: [
        "C4"
      ],
      playable: true,
      renderNoteIds: [
        "n1"
      ],
      staffIds: [
        "1"
      ],
      tieTypes: [],
      voiceIds: [
        "1"
      ]
    },
    {
      durationBeats: 1,
      entryCandidate: true,
      eventId: "event-1.0-1.0-1-1-p1-m1-e2",
      measureNumbers: [
        "1"
      ],
      onsetBeat: 1,
      pitches: [
        "C4"
      ],
      playable: true,
      renderNoteIds: [
        "n2"
      ],
      staffIds: [
        "1"
      ],
      tieTypes: [],
      voiceIds: [
        "1"
      ]
    },
    {
      durationBeats: 1,
      entryCandidate: true,
      eventId: "event-2.0-1.0-1-1-p1-m1-e3",
      measureNumbers: [
        "1"
      ],
      onsetBeat: 2,
      pitches: [
        "G4"
      ],
      playable: true,
      renderNoteIds: [
        "n3"
      ],
      staffIds: [
        "1"
      ],
      tieTypes: [
        "start"
      ],
      voiceIds: [
        "1"
      ]
    },
    {
      durationBeats: 1.5,
      entryCandidate: false,
      eventId: "event-3.0-1.5-1-1-p1-m2-e1",
      measureNumbers: [
        "2"
      ],
      onsetBeat: 3,
      pitches: [
        "G4"
      ],
      playable: true,
      renderNoteIds: [
        "n4"
      ],
      staffIds: [
        "1"
      ],
      tieTypes: [
        "stop"
      ],
      voiceIds: [
        "1"
      ]
    },
    {
      durationBeats: 1.5,
      entryCandidate: true,
      eventId: "event-3.0-1.5-1-2-p1-m2-e2",
      measureNumbers: [
        "2"
      ],
      onsetBeat: 3,
      pitches: [
        "A4",
        "C5"
      ],
      playable: true,
      renderNoteIds: [
        "n5",
        "n6"
      ],
      staffIds: [
        "1"
      ],
      tieTypes: [],
      voiceIds: [
        "2"
      ]
    },
    {
      durationBeats: 1.5,
      entryCandidate: true,
      eventId: "event-4.5-1.5-1-1-p1-m2-e4",
      measureNumbers: [
        "2"
      ],
      onsetBeat: 4.5,
      pitches: [
        "D5"
      ],
      playable: true,
      renderNoteIds: [
        "n7"
      ],
      staffIds: [
        "1"
      ],
      tieTypes: [],
      voiceIds: [
        "1"
      ]
    }
  ],
  practiceAttackSteps: [
    {
      attackTargets: [
        {
          attackId: "attack-0.0-05162c611506:target:C4:f41d35b19cfd",
          eventIds: [
            "event-0.0-1.0-1-1-p1-m1-e1"
          ],
          measureNumbers: [
            "1"
          ],
          notes: [
            {
              eventId: "event-0.0-1.0-1-1-p1-m1-e1",
              measureNumbers: [
                "1"
              ],
              pitch: "C4",
              renderNoteId: "n1",
              staffIds: [
                "1"
              ],
              stepNoteId: "event-0.0-1.0-1-1-p1-m1-e1:n1",
              voiceIds: [
                "1"
              ]
            }
          ],
          pitch: "C4",
          renderNoteIds: [
            "n1"
          ]
        }
      ],
      continuation: [],
      eventIds: [
        "event-0.0-1.0-1-1-p1-m1-e1"
      ],
      measureNumbers: [
        "1"
      ],
      onsetBeat: 0,
      renderNoteIds: [
        "n1"
      ],
      staffIds: [
        "1"
      ],
      stepId: "attack-0.0-05162c611506",
      voiceIds: [
        "1"
      ]
    },
    {
      attackTargets: [
        {
          attackId: "attack-1.0-57d82a629c08:target:C4:f51a37df0817",
          eventIds: [
            "event-1.0-1.0-1-1-p1-m1-e2"
          ],
          measureNumbers: [
            "1"
          ],
          notes: [
            {
              eventId: "event-1.0-1.0-1-1-p1-m1-e2",
              measureNumbers: [
                "1"
              ],
              pitch: "C4",
              renderNoteId: "n2",
              staffIds: [
                "1"
              ],
              stepNoteId: "event-1.0-1.0-1-1-p1-m1-e2:n2",
              voiceIds: [
                "1"
              ]
            }
          ],
          pitch: "C4",
          renderNoteIds: [
            "n2"
          ]
        }
      ],
      continuation: [],
      eventIds: [
        "event-1.0-1.0-1-1-p1-m1-e2"
      ],
      measureNumbers: [
        "1"
      ],
      onsetBeat: 1,
      renderNoteIds: [
        "n2"
      ],
      staffIds: [
        "1"
      ],
      stepId: "attack-1.0-57d82a629c08",
      voiceIds: [
        "1"
      ]
    },
    {
      attackTargets: [
        {
          attackId: "attack-2.0-1aede64d62ef:target:G4:abce10cd5e13",
          eventIds: [
            "event-2.0-1.0-1-1-p1-m1-e3"
          ],
          measureNumbers: [
            "1"
          ],
          notes: [
            {
              eventId: "event-2.0-1.0-1-1-p1-m1-e3",
              measureNumbers: [
                "1"
              ],
              pitch: "G4",
              renderNoteId: "n3",
              staffIds: [
                "1"
              ],
              stepNoteId: "event-2.0-1.0-1-1-p1-m1-e3:n3",
              voiceIds: [
                "1"
              ]
            }
          ],
          pitch: "G4",
          renderNoteIds: [
            "n3"
          ]
        }
      ],
      continuation: [],
      eventIds: [
        "event-2.0-1.0-1-1-p1-m1-e3"
      ],
      measureNumbers: [
        "1"
      ],
      onsetBeat: 2,
      renderNoteIds: [
        "n3"
      ],
      staffIds: [
        "1"
      ],
      stepId: "attack-2.0-1aede64d62ef",
      voiceIds: [
        "1"
      ]
    },
    {
      attackTargets: [
        {
          attackId: "attack-3.0-f5eb8414c490:target:A4:cb6fe267eb4d",
          eventIds: [
            "event-3.0-1.5-1-2-p1-m2-e2"
          ],
          measureNumbers: [
            "2"
          ],
          notes: [
            {
              eventId: "event-3.0-1.5-1-2-p1-m2-e2",
              measureNumbers: [
                "2"
              ],
              pitch: "A4",
              renderNoteId: "n5",
              staffIds: [
                "1"
              ],
              stepNoteId: "event-3.0-1.5-1-2-p1-m2-e2:n5",
              voiceIds: [
                "2"
              ]
            }
          ],
          pitch: "A4",
          renderNoteIds: [
            "n5"
          ]
        },
        {
          attackId: "attack-3.0-f5eb8414c490:target:C5:84ee62cc51f1",
          eventIds: [
            "event-3.0-1.5-1-2-p1-m2-e2"
          ],
          measureNumbers: [
            "2"
          ],
          notes: [
            {
              eventId: "event-3.0-1.5-1-2-p1-m2-e2",
              measureNumbers: [
                "2"
              ],
              pitch: "C5",
              renderNoteId: "n6",
              staffIds: [
                "1"
              ],
              stepNoteId: "event-3.0-1.5-1-2-p1-m2-e2:n6",
              voiceIds: [
                "2"
              ]
            }
          ],
          pitch: "C5",
          renderNoteIds: [
            "n6"
          ]
        }
      ],
      continuation: [
        {
          eventId: "event-3.0-1.5-1-1-p1-m2-e1",
          measureNumbers: [
            "2"
          ],
          pitch: "G4",
          renderNoteId: "n4",
          staffIds: [
            "1"
          ],
          stepNoteId: "event-3.0-1.5-1-1-p1-m2-e1:n4",
          voiceIds: [
            "1"
          ]
        }
      ],
      eventIds: [
        "event-3.0-1.5-1-1-p1-m2-e1",
        "event-3.0-1.5-1-2-p1-m2-e2"
      ],
      measureNumbers: [
        "2"
      ],
      onsetBeat: 3,
      renderNoteIds: [
        "n5",
        "n6",
        "n4"
      ],
      staffIds: [
        "1"
      ],
      stepId: "attack-3.0-f5eb8414c490",
      voiceIds: [
        "2",
        "1"
      ]
    },
    {
      attackTargets: [
        {
          attackId: "attack-4.5-547c4de8e393:target:D5:fdcdea355720",
          eventIds: [
            "event-4.5-1.5-1-1-p1-m2-e4"
          ],
          measureNumbers: [
            "2"
          ],
          notes: [
            {
              eventId: "event-4.5-1.5-1-1-p1-m2-e4",
              measureNumbers: [
                "2"
              ],
              pitch: "D5",
              renderNoteId: "n7",
              staffIds: [
                "1"
              ],
              stepNoteId: "event-4.5-1.5-1-1-p1-m2-e4:n7",
              voiceIds: [
                "1"
              ]
            }
          ],
          pitch: "D5",
          renderNoteIds: [
            "n7"
          ]
        }
      ],
      continuation: [],
      eventIds: [
        "event-4.5-1.5-1-1-p1-m2-e4"
      ],
      measureNumbers: [
        "2"
      ],
      onsetBeat: 4.5,
      renderNoteIds: [
        "n7"
      ],
      staffIds: [
        "1"
      ],
      stepId: "attack-4.5-547c4de8e393",
      voiceIds: [
        "1"
      ]
    }
  ],
  revisionId: "canonical-local-core-revision",
  schemaVersion: 1,
  scoreEndBeat: 6,
  scoreId: "canonical-local-core-score",
  scoreTempoSegments: [
    {
      bpm: 120,
      startBeat: 0
    },
    {
      bpm: 90,
      startBeat: 3
    }
  ]
};

// backend/research/step_microphone_browser_v26/contract.json
var contract_default = {
  phase: "STEP_MICROPHONE_BROWSER_RESOURCE_GRAPH_V26",
  startingHead: "3757d8c38d0ee750a2330fc15550151258e2e517",
  classification: "REAL_BROWSER_FAKE_MEDIA_SOURCE_EXPOSED_ENGINEERING_NOT_RECOGNITION_OR_PHYSICAL_DEVICE_QUALIFICATION",
  productionChangesAllowed: [],
  historyImmutable: "V3-V25",
  assetDelivery: {
    mode: "CORE_GRAPH_ONLY_RESEARCH_MODEL_URL_OVERRIDE",
    reason: "No running product backend/model-access API in the supplied local environment. Accepted Chrome harness lineage supplies a local verified model URL. Do not fabricate an API response or call that production delivery.",
    productionPlatform: "browserStepMicrophonePlatform is used for all factories/FIR/worklet paths, with one explicitly frozen modelUrl override to the fixed allowlisted /model.onnx asset",
    getPracticeAcousticModelAccessExecuted: false,
    maximumSuccessfulDisposition: "STEP_V26_BROWSER_CORE_GRAPH_ONLY_ASSET_DELIVERY_NOT_QUALIFIED"
  },
  browser: {
    executable: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    expectedFileVersion: "155.0.8059.80",
    headed: true,
    versionDiscovery: "Windows FileVersionInfo before freeze; browser.version plus CDP Browser.getVersion and SystemInfo.getInfo after launch; no browser launch before remote freeze",
    playwrightRoot: "backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright",
    flags: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=<frozen browser-input.wav>", "--autoplay-policy=no-user-gesture-required"],
    autoplayMeaning: "Harness-only autoplay permission bypass so AudioContext resume is deterministic; no permission-UX qualification"
  },
  cells: [
    { id: "normal-44100", rate: 44100, scenario: "normal" },
    { id: "normal-48000", rate: 48e3, scenario: "normal" },
    { id: "context-loss-44100", rate: 44100, scenario: "context-loss" },
    { id: "context-loss-48000", rate: 48e3, scenario: "context-loss" },
    { id: "root-loss-44100", rate: 44100, scenario: "root-loss" },
    { id: "root-loss-48000", rate: 48e3, scenario: "root-loss" }
  ],
  targets: [["E4"], ["E4"], ["G#3", "E4"], ["G#3", "E4"], ["A#2", "A#3"], ["A#2", "A#3"]],
  audioFamiliesInOrder: ["correct_single", "correct_chord", "post_ready_repeat"],
  audioTransform: "Accepted V6 44100 mono f32 LE clips in this fixed order; 12s leading zero silence, 1s zero gaps, 4s zero tail. For each finite sample v write signed PCM16 LE round(max(-1,min(1,v))*32767). No resampling/normalization/output-driven edits. Browser may resample fake-media to each requested AudioContext rate. WAV is exposed engineering input, not a fresh recording.",
  normalObservationSeconds: 43,
  executionBudget: {
    campaigns: 1,
    maximumCells: 6,
    maximumModelLoadsPerCell: 1,
    maximumWorkerOwnersPerCell: 1,
    maximumRunAttemptsPerCell: 96,
    hiddenWarmupRuns: 0,
    baselineOrCandidateTuning: false,
    retries: 0
  },
  deadlines: { startMs: 12e4, evidenceMs: 6e4, sourceLossMs: 3e3, cleanupMs: 15e3, cellMs: 18e4 },
  deadlineMeaning: "Engineering timeout/observation bounds only, never an eligibility delay or microphone cooldown",
  ownership: "APPLICATION_MICROPHONE_SESSION_OWNS_ROOT_STREAM_HEALTH",
  rootLossAction: "Call the application root track's actual stop(), then require the unchanged watchMicrophoneInfrastructure callback. No synthetic ended/mute event, polling substitute, watcher repair or manual fail in place of that callback. If no callback, preserve continued-clone behavior and fail the mandatory gate.",
  mute: "NOT_EVALUATED_BROWSER_FAKE_MEDIA_LIMITATION",
  handshake: "Initial runtime unavailable; owner.start issues physical boundary; runtime.acceptInputAfter then input.arm synchronously. After ordinary evidence runtime completes to POST_VERDICT; publication stack must unwind; owner-issued boundary then runtime.rearm then input.arm if domain active in one synchronous application call stack.",
  blockedPublicationStress: "First finalized normal-cell attempt remains POST_VERDICT until one further real publication has passed through the blocked assembler; then schedule the same physical retirement handshake. This is an explicit test stress barrier, not a product cooldown or timing policy.",
  instrumentation: "Transparent pass-through wrappers count real platform worker LOAD/INFER/DISPOSE and preserve return values. SourceAnalysisRuntime.create wraps only its real onPublication to retain unmodified publications. Prototype observers count real chronology/assembler receivers and actual BrowserAcousticCapture cleanup transitions. No fake inference, publication, source timestamp or evidence injection.",
  gates: ["real headed Chromium/WebGPU hardware", "real production capture/worklet/worker/ONNX/decoder/source runtime/assembler/v6 domain", "model SHA and ORT/provider/fallback exact", "both rate cells", "one persistent graph and one long-lived region", "gapless chronology and fixed origin", "physical retirement equality and source-only eligibility", "ordinary EVIDENCE with runtime-only verdict and rearm progression", "no observation reuse or busy queue", "normal input disposal leaves root/context live", "application watcher observes root loss", "context interruption terminal", "no production/history/capability mutation"],
  recognition: "Observed pitches/verdicts diagnostic only. No desired musical verdict/recognition rate gate. If no real EVIDENCE occurs the resource-consumption coverage is NOT_EXERCISED, never synthesize an attempt.",
  stopRules: ["remote freeze absent", "source/audio/asset identity mismatch", "any cell execution or tooling failure", "production patch required", "run/session budget violation", "unexpected owner/provider/fallback", "root watcher gate failure"],
  failurePolicy: "Stop remaining campaign cells on first failure; preserve partial receipts; no repair/rerun in V26",
  currentDefaults: { modelIdentity: "robust-browser-engineering-default-xc4-v1", modelSHA256: "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3", modelBytes: 98689283, rate: 16e3, inputSamples: 29120, inputMs: 1820, decoder: "A", onset: 0.3, frame: 0.05, ownedMs: 600, pastMs: 1050, futureMs: 170, ORT: "1.20.1", provider: "webgpu", automaticFallback: false },
  baselineClassification: "CURRENT_FROZEN_ENGINEERING_BASELINE_NOT_GLOBAL_OPTIMUM",
  domain: "schema6 / step-source-sensitive-verdict-v6; MIDI exact-set; microphone conservative tristate; H50 unchanged",
  cooldown: "FIXED_MICROPHONE_COOLDOWN_NOT_ESTABLISHED",
  capabilities: { Continuous: "MODEL_NOT_VALIDATED", STEP: "ATTEMPT_ANALYZER_NOT_VALIDATED", productionMicrophone: false, D4: false },
  physicalDevice: "REAL_PHYSICAL_MICROPHONE_DEVICE_NOT_QUALIFIED",
  nextAllowedPhase: "STOP_WAIT_FOR_INDEPENDENT_AUDIT_NO_CONTROLLER_OR_CAPABILITY_INTEGRATION"
};

// backend/research/step_microphone_browser_v26/entry.ts
var host = globalThis;
var demand = (value, code) => {
  if (!value) throw new Error(code);
};
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var deadline = async (promise, ms, code) => {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(code)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
};
var unique = (a) => [...new Set(a)].sort();
host.runV26 = async (cell) => {
  const trace = {
    cell,
    stage: "BEGIN",
    media: "REAL_BROWSER_FAKE_MEDIA_SOURCE",
    realDevice: false,
    assetDelivery: contract_default.assetDelivery,
    counts: {
      rootStreams: 0,
      analysisClones: 0,
      context: 0,
      workerOwners: 0,
      loadAttempts: 0,
      loadSuccesses: 0,
      runAttempts: 0,
      runSuccesses: 0,
      runFailures: 0,
      workerDisposeCalls: 0,
      captureConnections: 0,
      captureStopCalls: 0,
      captureStopTransitions: 0,
      sourceRuntimes: 0,
      chronologyInstances: 0,
      assemblerInstances: 0,
      sourceDisposals: 0
    },
    chronology: [],
    publications: [],
    runReceipts: [],
    attempts: [],
    boundaries: [],
    infrastructure: [],
    failures: [],
    applicationFailures: [],
    teardown: [],
    mute: "NOT_EVALUATED_BROWSER_FAKE_MEDIA_LIMITATION",
    fixedCooldownSelected: false,
    syntheticPublications: 0
  };
  host.v26Trace = trace;
  let input = null, domain = null;
  let context = null, root = null, clone = null;
  let watcherDetach = () => {
  }, applicationFailure = null, observedFailure = null;
  let pendingCommit = false, commitScheduled = false, holdForPublication = null;
  const abort = new AbortController(), chronologyOwners = /* @__PURE__ */ new Set(), assemblerOwners = /* @__PURE__ */ new Set();
  const originals = {
    create: SourceAnalysisRuntime.create,
    chronology: SourceChronology.prototype.accept,
    accept: StepAcousticAttemptAssembler.prototype.accept,
    arm: StepAcousticAttemptAssembler.prototype.acceptInputAfter,
    capture: BrowserAcousticCapture.connect,
    sourceDispose: SourceAnalysisRuntime.prototype.dispose
  };
  const appFail = (reason) => {
    if (applicationFailure) return;
    applicationFailure = reason;
    trace.applicationFailures.push({ reason, contextTime: context?.currentTime });
    abort.abort();
    void input?.dispose().catch((e) => trace.failures.push({ phase: "application-dispose", message: String(e) }));
  };
  const valid = () => {
    if (observedFailure || applicationFailure) throw observedFailure ?? new Error(applicationFailure);
  };
  const state = () => ({ input: input?.snapshot(), domain: domain?.snapshot(), contextTime: context?.currentTime });
  const commit = (boundary, initial = false) => {
    valid();
    demand(input && domain && context, "GRAPH_NOT_ATTACHED");
    const b = boundary ?? input.retirementBoundary(), before = state();
    demand(b.capturedThroughSourceSample === before.input.capture.capturedThroughSourceSample, "RETIREMENT_NOT_PHYSICAL_CAPTURE");
    demand(b.sessionTime.sampleIndex === b.capturedThroughSourceSample, "BOUNDARY_SOURCE_MAPPING");
    demand(input.clock.nowMs() === context.currentTime * 1e3, "MICROPHONE_CLOCK_NOT_AUDIO_CONTEXT");
    if (initial) domain.acceptInputAfter(b.sessionTime);
    else {
      demand(before.domain.step.attemptState === "POST_VERDICT", "REARM_WITHOUT_POST_VERDICT");
      domain.rearm(b.sessionTime);
    }
    if (domain.snapshot().runtimeStatus === "ACTIVE") input.arm(b);
    const after = state();
    demand(after.domain.step.targetGeneration === before.domain.step.targetGeneration + (!initial && before.domain.step.attempts.at(-1)?.verdict === "MATCH" ? 1 : 0), "GENERATION_NOT_REARM_OWNED");
    trace.boundaries.push({ initial, boundary: b, before, after, sameSynchronousCallStack: true });
    pendingCommit = false;
  };
  const scheduleCommit = () => {
    if (!pendingCommit || commitScheduled || applicationFailure || observedFailure) return;
    if (holdForPublication !== null && trace.publications.length < holdForPublication) return;
    commitScheduled = true;
    queueMicrotask(() => {
      commitScheduled = false;
      try {
        holdForPublication = null;
        commit();
      } catch (error) {
        observedFailure = error;
        appFail(String(error));
      }
    });
  };
  SourceChronology.prototype.accept = function(chunk) {
    originals.chronology.call(this, chunk);
    chronologyOwners.add(this);
    trace.counts.chronologyInstances = chronologyOwners.size;
    trace.chronology.push({
      sequence: chunk.sequence,
      start: chunk.sourceStartSampleIndex,
      end: chunk.sourceEndSampleIndex,
      rate: chunk.sourceSampleRateHz,
      origin: chunk.audioContextStartFrame - chunk.sourceStartSampleIndex,
      count: chunk.samples.length
    });
  };
  StepAcousticAttemptAssembler.prototype.accept = function(p) {
    assemblerOwners.add(this);
    trace.counts.assemblerInstances = assemblerOwners.size;
    const returned = originals.accept.call(this, p);
    if (returned) trace.lastSealedGesture = returned;
    return returned;
  };
  StepAcousticAttemptAssembler.prototype.acceptInputAfter = function(sample) {
    assemblerOwners.add(this);
    trace.counts.assemblerInstances = assemblerOwners.size;
    return originals.arm.call(this, sample);
  };
  SourceAnalysisRuntime.create = async (options) => {
    trace.counts.sourceRuntimes++;
    return originals.create.call(SourceAnalysisRuntime, { ...options, onPublication: (p) => {
      trace.publications.push(p);
      options.onPublication(p);
      scheduleCommit();
    } });
  };
  SourceAnalysisRuntime.prototype.dispose = async function() {
    trace.counts.sourceDisposals++;
    return originals.sourceDispose.call(this);
  };
  BrowserAcousticCapture.connect = async (options) => {
    trace.counts.captureConnections++;
    const capture = await originals.capture.call(BrowserAcousticCapture, options), stop = capture.stop.bind(capture);
    capture.stop = () => {
      trace.counts.captureStopCalls++;
      if (!capture.stopped) trace.counts.captureStopTransitions++;
      stop();
    };
    return capture;
  };
  try {
    context = new AudioContext({ sampleRate: cell.rate });
    trace.counts.context++;
    await context.resume();
    demand(context.sampleRate === cell.rate && context.state === "running", "AUDIO_CONTEXT_RATE_OR_STATE");
    trace.stage = "GET_USER_MEDIA";
    root = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    trace.counts.rootStreams++;
    trace.mediaSettings = root.getAudioTracks().map((t) => ({ settings: t.getSettings(), readyState: t.readyState, muted: t.muted, label: t.label }));
    const originalClone = root.clone.bind(root);
    root.clone = () => {
      trace.counts.analysisClones++;
      clone = originalClone();
      return clone;
    };
    watcherDetach = watchMicrophoneInfrastructure(root, context, (code) => {
      trace.infrastructure.push({
        code,
        state: context.state,
        tracks: root.getAudioTracks().map((t) => ({ readyState: t.readyState, muted: t.muted })),
        input: input?.snapshot(),
        atContextTime: context.currentTime
      });
      appFail(code);
    });
    const platform = {
      ...browserStepMicrophonePlatform,
      modelUrl: async () => new URL("/model.onnx", location.href).href,
      createWorker: () => {
        trace.counts.workerOwners++;
        const real = browserStepMicrophonePlatform.createWorker();
        return {
          onFailure: real.onFailure.bind(real),
          load: async (url) => {
            trace.counts.loadAttempts++;
            const receipt = await real.load(url);
            trace.counts.loadSuccesses++;
            trace.modelReceipt = receipt;
            return receipt;
          },
          run: async (value) => {
            demand(++trace.counts.runAttempts <= contract_default.executionBudget.maximumRunAttemptsPerCell, "V26_RUN_BUDGET_EXCEEDED");
            try {
              const result = await real.run(value);
              trace.counts.runSuccesses++;
              trace.runReceipts.push({ window: value.window, ...result });
              demand(result.actualSessionRunCount === trace.counts.runSuccesses, "ACTUAL_MODEL_RUN_SEQUENCE");
              return result;
            } catch (error) {
              trace.counts.runFailures++;
              throw error;
            }
          },
          dispose: async () => {
            trace.counts.workerDisposeCalls++;
            await real.dispose();
          }
        };
      }
    };
    input = new StepMicrophoneInput(platform, {
      open: (time) => {
        demand(time.sampleIndex > input.snapshot().retiredThroughSourceSample, "OLD_SOURCE_ATTEMPT_OPEN");
        const before = domain.snapshot(), id = domain.openAttempt(time);
        demand(id && before.step.attemptState === "READY", "NON_READY_OR_REJECTED_ACOUSTIC_OPEN");
        trace.lastOpen = { time, before, identity: id };
        return id;
      },
      complete: (identity, evidence) => {
        demand(evidence.kind === "EVIDENCE", "EXTERNAL_RETRY_NOT_ALLOWED");
        const before = domain.snapshot(), expected = domain.currentTarget().attackPitches;
        demand(domain.analyzeAttempt(identity), "ACTUAL_RUNTIME_ANALYZE_FAILED");
        const result = domain.completeAttempt(identity, evidence);
        demand(result.kind === "FINALIZED", "ACTUAL_RUNTIME_COMPLETE_FAILED");
        if (result.kind !== "FINALIZED" || evidence.kind !== "EVIDENCE") throw new Error("EVIDENCE_FINALIZATION_REQUIRED");
        const after = domain.snapshot();
        const o = unique(evidence.observedAttackPitches), e = unique(expected);
        const oracle = JSON.stringify(o) === JSON.stringify(e) ? "MATCH" : e.every((p) => o.includes(p)) ? "RETRY" : "MISMATCH";
        demand(result.record.verdict === oracle, "RUNTIME_SOURCE_POLICY_INCONSISTENCY");
        demand(after.step.attemptState === "POST_VERDICT" && after.step.currentIndex === before.step.currentIndex && after.step.targetGeneration === before.step.targetGeneration && after.runtimeStatus === "ACTIVE", "EARLY_DOMAIN_PROGRESSION");
        trace.attempts.push({ identity, evidence, record: result.record, expected, before, after, oracleAssertionAfterRuntime: true });
        pendingCommit = true;
        if (cell.scenario === "normal" && trace.attempts.length === 1) holdForPublication = trace.publications.length + 1;
        scheduleCommit();
      },
      failure: (error) => {
        trace.failures.push({ message: error.message, input: input?.snapshot() });
        appFail(error.message);
      }
    });
    trace.stage = "INPUT_START";
    const pending = input.start({ context, stream: root, localSessionId: cell.id, sourceDomainId: cell.id + ":capture" }, abort.signal);
    const base = canonical_practice_score_artifact_default;
    const artifact = {
      ...base,
      expectedPracticeGroups: contract_default.targets.map((pitches, index) => {
        const g = base.expectedPracticeGroups[index % base.expectedPracticeGroups.length];
        return {
          ...g,
          groupId: `v26:g:${index}`,
          pitches,
          strikeTargets: pitches.map((pitch, j) => ({ ...g.strikeTargets[0], strikeId: `v26:g:${index}:s:${j}`, pitch }))
        };
      }),
      practiceAttackSteps: contract_default.targets.map((pitches, index) => {
        const s = base.practiceAttackSteps[index % base.practiceAttackSteps.length];
        return {
          ...s,
          stepId: `v26:step:${index}`,
          groupId: `v26:g:${index}`,
          attackTargets: pitches.map((pitch, j) => ({ ...s.attackTargets[0], strikeId: `v26:g:${index}:s:${j}`, pitch })),
          continuation: []
        };
      })
    };
    domain = new StepPracticeRuntime({
      artifact,
      scope: { kind: "FULL" },
      inputSource: "MICROPHONE",
      clock: input.clock,
      localSessionId: cell.id,
      metadataClock: { nowEpochMs: () => Date.now() }
    });
    domain.setInputUnavailable();
    const boundary = await deadline(pending, contract_default.deadlines.startMs, "INPUT_START_TIMEOUT");
    trace.stage = "AVAILABLE";
    trace.initial = state();
    demand(trace.initial.input.resourceState === "AVAILABLE" && trace.initial.input.assembler.phase === "BLOCKED" && trace.initial.input.analysis.counts.regionsStarted === 1 && !domain.canAcceptAttempt, "INITIAL_READINESS_GRAPH");
    commit(boundary, true);
    trace.stage = "RUNNING";
    const started = context.currentTime;
    if (cell.scenario === "normal") {
      while (context.currentTime - started < contract_default.normalObservationSeconds && !domain.isCompleted) {
        valid();
        await sleep(20);
      }
      valid();
      demand(trace.publications.length > 0 && trace.attempts.length > 0 && trace.boundaries.length > 1, "REAL_EVIDENCE_CONSUMPTION_NOT_EXERCISED");
    } else {
      await deadline((async () => {
        while (trace.publications.length < 2) {
          valid();
          await sleep(20);
        }
      })(), contract_default.deadlines.evidenceMs, "REAL_PUBLICATIONS_NOT_EXERCISED");
      trace.beforeInfrastructureLoss = state();
      if (cell.scenario === "context-loss") {
        trace.stage = "CONTEXT_INTERRUPTION";
        await context.suspend();
      } else {
        trace.stage = "ROOT_TRACK_STOP";
        root.getAudioTracks()[0].stop();
        trace.rootImmediatelyAfterStop = root.getAudioTracks().map((t) => ({ readyState: t.readyState, muted: t.muted }));
      }
      const end = Date.now() + contract_default.deadlines.sourceLossMs;
      while (!applicationFailure && Date.now() < end) await sleep(20);
      trace.afterInfrastructureLoss = state();
      demand(applicationFailure && trace.infrastructure.length > 0, cell.scenario === "root-loss" ? "APPLICATION_ROOT_WATCHER_DID_NOT_OBSERVE_STOPPED_ROOT" : "APPLICATION_CONTEXT_WATCHER_DID_NOT_TERMINATE");
      await deadline(input.dispose(), contract_default.deadlines.cleanupMs, "FAILURE_CLEANUP_TIMEOUT");
      demand(trace.applicationFailures.length === 1 && trace.counts.workerDisposeCalls === 1 && clone.getTracks().every((t) => t.readyState === "ended"), "FAILURE_NOT_ONCE_OR_NOT_CLEAN");
    }
    trace.beforeInputDispose = state();
    watcherDetach();
    watcherDetach = () => {
    };
    await deadline(input.dispose(), contract_default.deadlines.cleanupMs, "INPUT_DISPOSE_TIMEOUT");
    trace.teardown.push({ kind: "INPUT_DISPOSE", root: root.getTracks().map((t) => t.readyState), clone: clone.getTracks().map((t) => t.readyState), contextState: context.state, input: input.snapshot() });
    if (cell.scenario !== "root-loss") demand(root.getTracks().every((t) => t.readyState === "live"), "INPUT_DISPOSE_STOPPED_BORROWED_ROOT");
    if (cell.scenario === "normal") demand(context.state === "running", "INPUT_DISPOSE_CLOSED_BORROWED_CONTEXT");
    demand(clone.getTracks().every((t) => t.readyState === "ended"), "ANALYSIS_CLONE_NOT_ENDED");
    demand(trace.counts.workerOwners === 1 && trace.counts.loadAttempts === 1 && trace.counts.loadSuccesses === 1 && trace.counts.workerDisposeCalls === 1 && trace.counts.sourceRuntimes === 1 && trace.counts.analysisClones === 1 && trace.counts.chronologyInstances === 1 && trace.counts.assemblerInstances === 1 && trace.counts.captureConnections === 1 && input.snapshot().analysis?.counts.regionsStarted === 1, "PERSISTENT_GRAPH_COUNTS");
    demand(trace.modelReceipt.actualSessionLoadCount === 1 && trace.modelReceipt.ortWebVersion === "1.20.1" && trace.modelReceipt.executionProvider === "webgpu" && trace.modelReceipt.automaticFallback === false && trace.modelReceipt.modelSha256 === contract_default.currentDefaults.modelSHA256, "REAL_MODEL_IDENTITY_PROVIDER");
    const origins = new Set(trace.chronology.map((c) => c.origin));
    demand(origins.size === 1, "CAPTURE_ORIGIN_CHANGED");
    const ids = /* @__PURE__ */ new Set();
    for (const attempt of trace.attempts) {
      const start = attempt.identity.attemptStartSessionTime.sampleIndex, end = attempt.evidence.captureEndSessionTime.sampleIndex;
      for (const p of trace.publications) for (const o of p.observations) if (o.sourceEventSample >= start && o.sourceEventSample < end) {
        demand(!ids.has(o.observationId), "OBSERVATION_TWO_ATTEMPTS");
        ids.add(o.observationId);
      }
    }
    trace.stage = "COMPLETE";
    trace.status = "PASS";
  } catch (error) {
    trace.status = "FAILED";
    trace.error = String(error.stack ?? error);
    trace.failureState = state();
  } finally {
    watcherDetach();
    if (input) {
      try {
        await deadline(input.dispose(), contract_default.deadlines.cleanupMs, "FINAL_CLEANUP_TIMEOUT");
      } catch (error) {
        trace.cleanupError = String(error);
      }
    }
    trace.afterInputCleanup = { ...state(), root: root?.getTracks().map((t) => t.readyState), clone: clone?.getTracks().map((t) => t.readyState) };
    if (root) for (const track of root.getTracks()) track.stop();
    if (context && context.state !== "closed") await context.close();
    trace.teardown.push({ kind: "APPLICATION_SESSION_DISPOSE", root: root?.getTracks().map((t) => t.readyState), contextState: context?.state });
    SourceAnalysisRuntime.create = originals.create;
    SourceAnalysisRuntime.prototype.dispose = originals.sourceDispose;
    SourceChronology.prototype.accept = originals.chronology;
    StepAcousticAttemptAssembler.prototype.accept = originals.accept;
    StepAcousticAttemptAssembler.prototype.acceptInputAfter = originals.arm;
    BrowserAcousticCapture.connect = originals.capture;
    trace.finalCounts = { ...trace.counts };
    trace.finalDomain = domain?.snapshot();
    trace.sameTargetAcceptance = trace.attempts.some((a, i) => i > 0 && JSON.stringify(a.expected) === JSON.stringify(trace.attempts[i - 1].expected)) ? "REAL_DISTINCT_SOURCE_ATTEMPTS_OBSERVED" : "SECOND_IDENTICAL_TARGET_ACCEPTANCE_NOT_EXERCISED";
  }
  return trace;
};
