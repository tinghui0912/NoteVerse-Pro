// apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts
import * as ort from "/ort/ort.webgpu.min.mjs";

// apps/customer-web/src/lib/model-assets/types.ts
var ASSET_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,127}$/;
var ModelAssetStorageUnavailableError = class extends Error {
  constructor(message = "OPFS storage is unavailable in this browser environment.") {
    super(message);
    this.name = "ModelAssetStorageUnavailableError";
  }
};
var ModelAssetDownloadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelAssetDownloadError";
  }
};
var ModelAssetIntegrityError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelAssetIntegrityError";
  }
};
var ModelAssetStorageError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelAssetStorageError";
  }
};
function sanitizeUrlForError(rawUrl) {
  try {
    const parsed = new URL(rawUrl, "http://127.0.0.1");
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "redacted-url";
  }
}

// apps/customer-web/src/lib/model-assets/model-asset-store.ts
var MODEL_ASSET_STORAGE_ROOT = "noteverse-model-assets";
var MODEL_ASSET_SCHEMA_VERSION_DIR = "v1";
var ModelAssetStore = class {
  constructor(options = {}) {
    this.options = options;
    this.inFlight = /* @__PURE__ */ new Map();
  }
  async ensureAsset(descriptor, onProgress) {
    validateModelAssetDescriptor(descriptor);
    const key = `${descriptor.assetId.toLowerCase()}:${descriptor.sha256.toLowerCase()}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const loadPromise = this.loadAssetInternal(descriptor, onProgress);
    this.inFlight.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.inFlight.delete(key);
    }
  }
  async loadAssetInternal(descriptor, onProgress) {
    const root = await this.getRootDirectory();
    const persistentStorageGranted = await this.requestPersistence();
    const loadStartedAt = this.now();
    let baseDir;
    let v1Dir;
    let assetDir;
    let entryDir;
    try {
      baseDir = await root.getDirectoryHandle(MODEL_ASSET_STORAGE_ROOT, { create: true });
      v1Dir = await baseDir.getDirectoryHandle(MODEL_ASSET_SCHEMA_VERSION_DIR, { create: true });
      assetDir = await v1Dir.getDirectoryHandle(descriptor.assetId, { create: true });
      entryDir = await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase(), { create: true });
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to initialize OPFS directory structure: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const cacheResult = await this.tryReadCachedAsset(
      assetDir,
      entryDir,
      descriptor,
      loadStartedAt,
      persistentStorageGranted
    );
    if (cacheResult) {
      return cacheResult;
    }
    await entryDir.removeEntry("verified.json").catch(() => void 0);
    await entryDir.removeEntry("model.bin").catch(() => void 0);
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    let response;
    try {
      response = await fetchImpl(descriptor.url);
    } catch (error) {
      throw new ModelAssetDownloadError(
        `Network fetch failed for ${sanitizeUrlForError(descriptor.url)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!response.ok) {
      throw new ModelAssetDownloadError(
        `Download failed with HTTP ${response.status} for ${sanitizeUrlForError(descriptor.url)}.`
      );
    }
    if (!response.body) {
      throw new ModelAssetDownloadError(
        `Download response body is empty for ${sanitizeUrlForError(descriptor.url)}.`
      );
    }
    const downloadStartedAt = this.now();
    let binHandle;
    try {
      binHandle = await entryDir.getFileHandle("model.bin", { create: true });
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to create model.bin: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    let writable;
    try {
      writable = await binHandle.createWritable();
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to open writable stream for model.bin: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const totalBytesHeader = response.headers.get("content-length");
    const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : null;
    let bytesDownloaded = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        let readResult;
        try {
          readResult = await reader.read();
        } catch (readError) {
          await writable.abort().catch(() => void 0);
          await entryDir.removeEntry("model.bin").catch(() => void 0);
          throw new ModelAssetDownloadError(
            `Streaming download failed for ${sanitizeUrlForError(descriptor.url)}: ${readError instanceof Error ? readError.message : String(readError)}`
          );
        }
        if (readResult.done) {
          break;
        }
        try {
          await writable.write(readResult.value);
        } catch (writeError) {
          await writable.abort().catch(() => void 0);
          await entryDir.removeEntry("model.bin").catch(() => void 0);
          throw new ModelAssetStorageError(
            `Failed to write to model.bin: ${writeError instanceof Error ? writeError.message : String(writeError)}`
          );
        }
        bytesDownloaded += readResult.value.byteLength;
        onProgress?.({
          bytesDownloaded,
          totalBytes: Number.isFinite(totalBytes) ? totalBytes : null
        });
      }
      try {
        await writable.close();
      } catch (closeError) {
        await entryDir.removeEntry("model.bin").catch(() => void 0);
        throw new ModelAssetStorageError(
          `Failed to close writable stream for model.bin: ${closeError instanceof Error ? closeError.message : String(closeError)}`
        );
      }
    } catch (error) {
      if (error instanceof ModelAssetDownloadError || error instanceof ModelAssetStorageError || error instanceof ModelAssetIntegrityError) {
        throw error;
      }
      await writable.abort().catch(() => void 0);
      await entryDir.removeEntry("model.bin").catch(() => void 0);
      throw new ModelAssetStorageError(
        `Unexpected error during model download/storage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const downloadMs = this.now() - downloadStartedAt;
    const readStartedAt = this.now();
    let file;
    let bytes;
    try {
      file = await binHandle.getFile();
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      await entryDir.removeEntry("model.bin").catch(() => void 0);
      throw new ModelAssetStorageError(
        `Failed to read downloaded model.bin from OPFS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const cacheReadMs = this.now() - readStartedAt;
    if (bytes.byteLength !== descriptor.expectedByteSize) {
      await entryDir.removeEntry("model.bin").catch(() => void 0);
      throw new ModelAssetIntegrityError(
        `Downloaded model byte size mismatch: expected ${descriptor.expectedByteSize}, got ${bytes.byteLength}.`
      );
    }
    const verifyStartedAt = this.now();
    const digest = await computeSha256Hex(bytes);
    const verificationMs = this.now() - verifyStartedAt;
    if (digest.toLowerCase() !== descriptor.sha256.toLowerCase()) {
      await entryDir.removeEntry("model.bin").catch(() => void 0);
      throw new ModelAssetIntegrityError(
        `Downloaded model SHA256 mismatch: expected ${descriptor.sha256}, got ${digest}.`
      );
    }
    const marker = {
      schemaVersion: 1,
      assetId: descriptor.assetId,
      assetVersion: descriptor.assetVersion,
      expectedByteSize: descriptor.expectedByteSize,
      sha256: descriptor.sha256.toLowerCase(),
      verifiedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    try {
      const markerHandle = await entryDir.getFileHandle("verified.json", { create: true });
      const markerWritable = await markerHandle.createWritable();
      await markerWritable.write(JSON.stringify(marker, null, 2));
      await markerWritable.close();
    } catch (error) {
      await entryDir.removeEntry("verified.json").catch(() => void 0);
      await entryDir.removeEntry("model.bin").catch(() => void 0);
      throw new ModelAssetStorageError(
        `Failed to write activation marker: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    await this.pruneOtherVersionsForAsset(assetDir, descriptor.sha256.toLowerCase());
    return {
      bytes,
      diagnostics: {
        source: "network",
        downloadMs,
        cacheReadMs,
        verificationMs,
        totalLoadMs: this.now() - loadStartedAt,
        byteSize: bytes.byteLength,
        sha256: descriptor.sha256,
        persistentStorageGranted
      }
    };
  }
  async tryReadCachedAsset(assetDir, entryDir, descriptor, loadStartedAt, persistentStorageGranted) {
    let markerHandle;
    try {
      markerHandle = await entryDir.getFileHandle("verified.json");
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw new ModelAssetStorageError(
        `Failed to access verified.json from OPFS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    let markerFile;
    try {
      markerFile = await markerHandle.getFile();
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to get File for verified.json from OPFS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    let markerText;
    try {
      markerText = await markerFile.text();
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to read verified.json text from OPFS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    let marker;
    try {
      marker = JSON.parse(markerText);
    } catch {
      return null;
    }
    if (!marker || typeof marker !== "object" || marker.schemaVersion !== 1 || marker.assetId !== descriptor.assetId || marker.expectedByteSize !== descriptor.expectedByteSize || marker.sha256?.toLowerCase() !== descriptor.sha256.toLowerCase()) {
      return null;
    }
    let binHandle;
    try {
      binHandle = await entryDir.getFileHandle("model.bin");
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw new ModelAssetStorageError(
        `Failed to access model.bin from OPFS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const readStartedAt = this.now();
    let file;
    try {
      file = await binHandle.getFile();
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to get File for model.bin from OPFS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to read model.bin arrayBuffer from OPFS: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const bytes = new Uint8Array(arrayBuffer);
    const cacheReadMs = this.now() - readStartedAt;
    if (bytes.byteLength !== descriptor.expectedByteSize) {
      return null;
    }
    const verifyStartedAt = this.now();
    const digest = await computeSha256Hex(bytes);
    const verificationMs = this.now() - verifyStartedAt;
    if (digest.toLowerCase() !== descriptor.sha256.toLowerCase()) {
      return null;
    }
    if (marker.assetVersion !== descriptor.assetVersion) {
      try {
        const markerWritable = await markerHandle.createWritable();
        const updatedMarker = {
          ...marker,
          assetVersion: descriptor.assetVersion,
          verifiedAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await markerWritable.write(JSON.stringify(updatedMarker, null, 2));
        await markerWritable.close();
      } catch {
      }
    }
    await this.pruneOtherVersionsForAsset(assetDir, descriptor.sha256.toLowerCase());
    return {
      bytes,
      diagnostics: {
        source: "opfs-cache",
        cacheReadMs,
        verificationMs,
        totalLoadMs: this.now() - loadStartedAt,
        byteSize: bytes.byteLength,
        sha256: descriptor.sha256,
        persistentStorageGranted
      }
    };
  }
  async pruneOtherVersionsForAsset(assetDir, activeDirName) {
    try {
      const entries = assetDir.entries?.();
      if (entries && typeof entries[Symbol.asyncIterator] === "function") {
        for await (const [name, handle] of entries) {
          if (handle.kind === "directory" && name.toLowerCase() !== activeDirName.toLowerCase()) {
            await assetDir.removeEntry(name, { recursive: true }).catch(() => void 0);
          }
        }
      }
    } catch {
    }
  }
  async getRootDirectory() {
    if (this.options.getDirectory) {
      return this.options.getDirectory();
    }
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
      throw new ModelAssetStorageUnavailableError();
    }
    return navigator.storage.getDirectory();
  }
  async requestPersistence() {
    if (this.options.persist) {
      return this.options.persist();
    }
    try {
      if (typeof navigator !== "undefined" && navigator.storage?.persist) {
        return await navigator.storage.persist();
      }
    } catch {
      return null;
    }
    return null;
  }
  now() {
    return this.options.nowMs?.() ?? globalThis.performance?.now?.() ?? Date.now();
  }
};
function createModelAssetStore(options) {
  return new ModelAssetStore(options);
}
function validateModelAssetDescriptor(descriptor) {
  if (descriptor.schemaVersion !== 1) {
    throw new Error("Unsupported model asset descriptor schema version.");
  }
  if (!descriptor.assetId || typeof descriptor.assetId !== "string" || !ASSET_ID_REGEX.test(descriptor.assetId)) {
    throw new Error("Model asset descriptor assetId must match /^[a-z0-9][a-z0-9._-]{0,127}$/.");
  }
  if (!descriptor.assetVersion || typeof descriptor.assetVersion !== "string") {
    throw new Error("Model asset descriptor must include an assetVersion.");
  }
  if (!descriptor.url || typeof descriptor.url !== "string") {
    throw new Error("Model asset descriptor must include a URL.");
  }
  if (!Number.isFinite(descriptor.expectedByteSize) || descriptor.expectedByteSize <= 0) {
    throw new Error("Model asset descriptor expectedByteSize must be a positive number.");
  }
  if (!/^[a-f0-9]{64}$/i.test(descriptor.sha256)) {
    throw new Error("Model asset descriptor sha256 must be a 64-character hex string.");
  }
  if (descriptor.mediaType !== "application/octet-stream") {
    throw new Error("Model asset descriptor mediaType must be 'application/octet-stream'.");
  }
}
async function computeSha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto SHA-256 is unavailable; cannot verify model integrity.");
  }
  const copy = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}
function isNotFoundError(error) {
  return typeof error === "object" && error !== null && error.name === "NotFoundError";
}

// apps/customer-web/src/lib/model-assets/verified-model-asset-loader.ts
function createVerifiedModelAssetLoader(options) {
  const store = createModelAssetStore(options);
  return (asset) => store.ensureAsset(asset);
}

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

// apps/customer-web/src/lib/practice/acoustic/model/raw-output-contract.ts
var PIANO_OUTPUT_FRAME_RATE_HZ = 100;
var PIANO_PITCH_COUNT = 88;

// apps/customer-web/src/lib/practice/acoustic/model/robust-piano-decoder.ts
function decodeRobustPiano(raw, inputStartSample, thresholds) {
  const onset = matrix(raw.reg_onset_output, raw.reg_onset_shape);
  const frame = matrix(raw.frame_output, raw.frame_shape);
  if (onset.frameCount !== frame.frameCount) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
  const events = [];
  for (let pitchIndex = 0; pitchIndex < PIANO_PITCH_COUNT; pitchIndex++) {
    let index = 0;
    while (index < onset.frameCount) {
      while (index < onset.frameCount && onset.value(index, pitchIndex) < thresholds.onsetThreshold) index++;
      if (index >= onset.frameCount) break;
      let peak = index, peakScore = onset.value(index, pitchIndex);
      while (index + 1 < onset.frameCount && onset.value(index + 1, pitchIndex) >= thresholds.onsetThreshold) {
        index++;
        const score = onset.value(index, pitchIndex);
        if (score > peakScore) {
          peak = index;
          peakScore = score;
        }
      }
      index++;
      const frameScore = frame.value(peak, pitchIndex);
      if (frameScore < thresholds.frameThreshold) continue;
      const midiPitch = 21 + pitchIndex;
      const sampleOffset = Math.round(peak / PIANO_OUTPUT_FRAME_RATE_HZ * ACOUSTIC_MODEL.sampleRateHz);
      events.push(Object.freeze({
        pitch: pitchName(midiPitch),
        midiPitch,
        targetSample: inputStartSample + sampleOffset,
        confidence: Math.min(peakScore, frameScore),
        onsetScore: peakScore,
        frameScore
      }));
    }
  }
  return events.sort((a, b) => a.targetSample - b.targetSample || a.midiPitch - b.midiPitch);
}
function matrix(data, shape) {
  if (shape.length !== 2 && shape.length !== 3 || shape.length === 3 && shape[0] !== 1) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
  const frameCount = shape.length === 3 ? shape[1] : shape[0];
  if (shape.at(-1) !== PIANO_PITCH_COUNT || !Number.isInteger(frameCount) || frameCount <= 0 || data.length !== frameCount * PIANO_PITCH_COUNT) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
  if (data.some((v) => !Number.isFinite(v))) fail("ACOUSTIC_NONFINITE_OUTPUT");
  return { frameCount, value: (frame, pitch) => data[frame * PIANO_PITCH_COUNT + pitch] };
}
function pitchName(midi) {
  return `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`;
}

// apps/customer-web/src/lib/practice/acoustic/model/model-validation.ts
function assertWindowGeometry(w) {
  if (w.ownedEndTarget <= w.ownedStartTarget || w.ownedEndTarget > w.ownedStartTarget + ACOUSTIC_MODEL.ownedMs * 16 || w.endSample - w.startSample !== ACOUSTIC_MODEL.inputSamples || Math.abs(w.endSample - w.ownedEndTarget - ACOUSTIC_MODEL.futureMs * 16) > 1) fail("ACOUSTIC_WORKER_WINDOW_MISMATCH");
}
function assertModelNames(inputNames, outputNames) {
  if (inputNames?.join() !== "audio" || outputNames?.join() !== "reg_onset_output,frame_output") fail("ACOUSTIC_MODEL_DESCRIPTOR_MISMATCH");
}
function checkedOutput(tensor) {
  if (!tensor || tensor.dims.join() !== "1,183,88" || tensor.data.length !== 183 * 88) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
  const data = Float32Array.from(tensor.data);
  if (data.some((v) => !Number.isFinite(v))) fail("ACOUSTIC_NONFINITE_OUTPUT");
  return data;
}

// apps/customer-web/src/lib/practice/acoustic/model/acoustic-model-manifest.ts
function practiceAcousticModelManifest(url) {
  const asset = Object.freeze({
    schemaVersion: 1,
    assetId: "practice-acoustic-robust-browser",
    assetVersion: "v1",
    url,
    expectedByteSize: ACOUSTIC_MODEL.modelBytes,
    sha256: ACOUSTIC_MODEL.modelSha256,
    mediaType: "application/octet-stream"
  });
  return Object.freeze({
    asset,
    ortVersion: ACOUSTIC_MODEL.ortVersion,
    provider: ACOUSTIC_MODEL.provider,
    automaticFallback: ACOUSTIC_MODEL.automaticFallback,
    acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256,
    input: Object.freeze({ name: "audio", dtype: "float32", shape: Object.freeze([1, 29120]) }),
    outputs: Object.freeze(["reg_onset_output", "frame_output"].map((name) => Object.freeze({ name, dtype: "float32", shape: Object.freeze([1, 183, 88]) }))),
    decoder: Object.freeze({
      identity: "A",
      sourceSha256: acoustic_core_identity_default.decoder.authoritativeSource.sha256,
      function: acoustic_core_identity_default.decoder.function,
      onsetThreshold: ACOUSTIC_MODEL.onsetThreshold,
      frameThreshold: ACOUSTIC_MODEL.frameThreshold
    })
  });
}

// apps/customer-web/src/lib/practice/acoustic/model/model-inference.ts
function decodeAcousticOutputs(raw, input) {
  return decodeRobustPiano(raw, input.window.startSample, ACOUSTIC_MODEL);
}
async function verifyAcousticModel(bytes) {
  if (bytes.byteLength !== ACOUSTIC_MODEL.modelBytes || await sha256(bytes) !== ACOUSTIC_MODEL.modelSha256) fail("ACOUSTIC_MODEL_IDENTITY_MISMATCH");
}
function outputData(tensor) {
  if (!tensor || tensor.type !== "float32" || !(tensor.data instanceof Float32Array)) fail("ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH");
  return checkedOutput({ dims: tensor.dims, data: tensor.data });
}
var AcousticModelSession = class {
  constructor() {
    this.state = "EMPTY";
    this.busy = false;
    this.session = null;
    this.nextJob = 0;
    this.loads = 0;
    this.runs = 0;
  }
  async load(modelUrl) {
    if (this.busy || this.state !== "EMPTY") fail("ACOUSTIC_WORKER_NOT_EMPTY");
    this.busy = true;
    let session = null;
    try {
      await assertAcousticIdentity();
      if (ort.env.versions.web !== ACOUSTIC_MODEL.ortVersion) fail("ORT_VERSION_MISMATCH");
      if (typeof navigator === "undefined" || !navigator.gpu) fail("ACOUSTIC_WEBGPU_UNAVAILABLE");
      const manifest = practiceAcousticModelManifest(modelUrl), started = performance.now();
      const loaded = await createVerifiedModelAssetLoader()(manifest.asset);
      await verifyAcousticModel(loaded.bytes);
      const verifiedAt = performance.now();
      session = await ort.InferenceSession.create(loaded.bytes, { executionProviders: [manifest.provider], graphOptimizationLevel: "disabled" });
      this.loads++;
      assertModelNames(session.inputNames, session.outputNames);
      this.session = session;
      this.state = "READY";
      return {
        ...loaded.diagnostics,
        assetId: manifest.asset.assetId,
        assetVersion: manifest.asset.assetVersion,
        modelByteSize: loaded.bytes.length,
        modelSha256: manifest.asset.sha256,
        executionProvider: manifest.provider,
        modelFetchAndVerifyMs: verifiedAt - started,
        sessionCreateMs: performance.now() - verifiedAt,
        acousticCoreIdentitySha256: ACOUSTIC_MODEL.identitySha256,
        ortWebVersion: ort.env.versions.web,
        automaticFallback: false,
        actualSessionLoadCount: this.loads,
        inputDescriptor: { name: "audio", dtype: "float32", shape: [1, 29120] },
        outputDescriptors: { reg_onset_output: [1, 183, 88], frame_output: [1, 183, 88] }
      };
    } catch (error) {
      this.state = "FAILED";
      await session?.release();
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async run(input) {
    onlyFields(input, ["window", "pcm"]);
    onlyFields(input.window, ["jobIndex", "regionIndex", "windowIndex", "ownedStartTarget", "ownedEndTarget", "startSample", "endSample"]);
    if (this.busy) fail("ACOUSTIC_WORKER_CONCURRENCY_REJECTED");
    if (this.state !== "READY" || !this.session) fail("ACOUSTIC_WORKER_NOT_READY");
    const w = input.window;
    assertWindowGeometry(w);
    if (w.jobIndex !== this.nextJob || !(input.pcm instanceof Float32Array) || input.pcm.length !== ACOUSTIC_MODEL.inputSamples || input.pcm.some((v) => !Number.isFinite(v))) fail("ACOUSTIC_WORKER_WINDOW_MISMATCH");
    this.busy = true;
    try {
      const started = performance.now();
      const audio = new ort.Tensor("float32", input.pcm, [1, 29120]);
      let tensors;
      let raw;
      try {
        this.runs++;
        tensors = await this.session.run({ audio }, ["reg_onset_output", "frame_output"]);
        raw = {
          reg_onset_output: outputData(tensors.reg_onset_output),
          reg_onset_shape: [1, 183, 88],
          frame_output: outputData(tensors.frame_output),
          frame_shape: [1, 183, 88]
        };
      } finally {
        audio.dispose();
        for (const tensor of Object.values(tensors ?? {})) tensor.dispose();
      }
      const inferred = performance.now(), events = decodeAcousticOutputs(raw, input), decoded = performance.now();
      this.nextJob++;
      return { events, inferenceMs: inferred - started, decodeMs: decoded - inferred, actualSessionRunCount: this.runs };
    } catch (error) {
      this.state = "FAILED";
      throw error;
    } finally {
      this.busy = false;
    }
  }
  async dispose() {
    if (this.busy) fail("ACOUSTIC_WORKER_CONCURRENCY_REJECTED");
    try {
      await this.session?.release();
    } finally {
      this.session = null;
      this.state = "DISPOSED";
    }
  }
};

// apps/customer-web/src/lib/practice/acoustic/model/acoustic-worker.entry.ts
var inference = new AcousticModelSession();
self.onmessage = async (event) => {
  const message = event.data;
  try {
    onlyFields(message, ["id", "type", ...message.type === "LOAD" ? ["modelUrl"] : message.type === "INFER" ? ["input"] : []]);
    if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new Error("INVALID_WORKER_REQUEST");
    let result;
    if (message.type === "LOAD" && typeof message.modelUrl === "string") result = await inference.load(message.modelUrl);
    else if (message.type === "INFER" && message.input) result = await inference.run(message.input);
    else if (message.type === "DISPOSE") result = await inference.dispose();
    else throw new Error("INVALID_WORKER_REQUEST");
    self.postMessage({ id: message.id, result });
  } catch (error) {
    self.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
  }
};
