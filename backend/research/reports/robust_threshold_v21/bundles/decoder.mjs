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

// apps/customer-web/src/lib/practice/acoustic/runtime/source-publication.ts
function sourcePublication(domain, rate, base, window, result, availabilityTimeMs) {
  if (result.events.length > ACOUSTIC_RESOURCES.maxEventsPerWindow) fail("ACOUSTIC_EVENT_BOUND_EXCEEDED");
  const ids = /* @__PURE__ */ new Set();
  const observations = result.events.filter((e) => e.targetSample >= window.ownedStartTarget && e.targetSample < window.ownedEndTarget).map((e) => {
    if (!Number.isSafeInteger(e.targetSample) || !Number.isInteger(e.midiPitch) || e.midiPitch < 21 || e.midiPitch > 108 || !Number.isFinite(e.confidence) || e.confidence < 0 || e.confidence > 1 || !Number.isFinite(e.onsetScore) || !Number.isFinite(e.frameScore)) fail("ACOUSTIC_EVENT_IDENTITY_MISMATCH");
    const numerator = base * 16e3 + e.targetSample * rate;
    if (!Number.isSafeInteger(numerator)) fail("ACOUSTIC_SOURCE_COORDINATE_OVERFLOW");
    const observationId = `${domain}:r${window.regionIndex}:w${window.windowIndex}:p${e.midiPitch}:f${e.targetSample}`;
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
  return Object.freeze({
    sourceDomainId: domain,
    sourceSampleRateHz: rate,
    window,
    availabilityTimeMs,
    observations: Object.freeze(observations)
  });
}
export {
  decodeRobustPiano,
  sourcePublication
};
