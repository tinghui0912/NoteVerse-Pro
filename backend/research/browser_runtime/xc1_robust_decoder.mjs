export const ROBUST_DECODER_SCHEMA_VERSION = 1;

export const ROBUST_DECODER_IDENTITY = Object.freeze({
  decoderId: 'noteverse-bytedance-decodeByteDanceRawOutputs-parity-v1',
  onsetThreshold: 0.30,
  frameThreshold: 0.05,
  outputFrameRateHz: 100,
  midiLowestPianoKey: 21,
  inputSamples: 29120,
  ownershipFiltering: 'half-open-600ms-region',
});

export function decodeRobustRawOutputs({
  regData,
  frameData,
  dims,
  inputWindowStartMs,
  sampleRateHz = 16000,
  takeId = 'unknown-take',
  windowId = 'window',
  inferenceCompletedAtMs,
  decoder = ROBUST_DECODER_IDENTITY,
}) {
  const shape = normalizeOutputShape(dims, regData, 'reg_onset_output');
  const frameShape = normalizeOutputShape(dims, frameData, 'frame_output');
  if (shape.frameCount !== frameShape.frameCount || shape.pitchCount !== frameShape.pitchCount) {
    throw new Error('XC1_ROBUST_ONSET_FRAME_SHAPE_MISMATCH');
  }
  const observations = [];
  for (let pitchIndex = 0; pitchIndex < shape.pitchCount; pitchIndex += 1) {
    let frameIndex = 0;
    while (frameIndex < shape.frameCount) {
      while (
        frameIndex < shape.frameCount
        && valueAt(regData, shape.pitchCount, frameIndex, pitchIndex) < decoder.onsetThreshold
      ) {
        frameIndex += 1;
      }
      if (frameIndex >= shape.frameCount) break;
      let peakFrame = frameIndex;
      let peakScore = valueAt(regData, shape.pitchCount, frameIndex, pitchIndex);
      while (
        frameIndex + 1 < shape.frameCount
        && valueAt(regData, shape.pitchCount, frameIndex + 1, pitchIndex) >= decoder.onsetThreshold
      ) {
        frameIndex += 1;
        const score = valueAt(regData, shape.pitchCount, frameIndex, pitchIndex);
        if (score > peakScore) {
          peakScore = score;
          peakFrame = frameIndex;
        }
      }
      const frameScore = valueAt(frameData, shape.pitchCount, peakFrame, pitchIndex);
      if (frameScore >= decoder.frameThreshold) {
        const midiPitch = decoder.midiLowestPianoKey + pitchIndex;
        const sampleOffset = Math.round(peakFrame / decoder.outputFrameRateHz * sampleRateHz);
        const performanceTimeMs = inputWindowStartMs + sampleOffset / sampleRateHz * 1000;
        observations.push({
          pitch: midiPitch,
          performanceTimeMs,
          confidence: Math.min(peakScore, frameScore),
          onsetScore: peakScore,
          frameScore,
          inferenceCompletedAtMs,
          candidateObservationId: [
            'robust-browser-v1',
            sanitize(takeId),
            sanitize(windowId),
            midiPitch,
            sampleOffset,
            observations.length,
          ].join(':'),
          peakFrame,
        });
      }
      frameIndex += 1;
    }
  }
  return observations.sort((left, right) => (
    left.performanceTimeMs - right.performanceTimeMs
    || left.pitch - right.pitch
    || left.candidateObservationId.localeCompare(right.candidateObservationId)
  ));
}

export function filterOwnedObservations(observations, ownedStartMs, ownedEndMs) {
  return observations.filter((observation) => (
    observation.performanceTimeMs >= ownedStartMs
    && observation.performanceTimeMs < ownedEndMs
  ));
}

export function planOwnedWindows({
  durationMs,
  scoreableStartMs = 1000,
  scoreableEndMs,
  ownedMs = 600,
  pastMs = 1000,
  futureMs = 220,
  sampleRateHz = 16000,
  inputSamples = 29120,
}) {
  const end = scoreableEndMs ?? Math.max(scoreableStartMs, durationMs - futureMs);
  const windows = [];
  for (let ownedStartMs = scoreableStartMs; ownedStartMs < end; ownedStartMs += ownedMs) {
    const ownedEndMs = Math.min(ownedStartMs + ownedMs, end);
    const shiftedFinalWindow = ownedEndMs - ownedStartMs < ownedMs;
    const inputWindowEndMs = ownedEndMs + futureMs;
    const inputWindowStartMs = shiftedFinalWindow
      ? inputWindowEndMs - inputSamples / sampleRateHz * 1000
      : ownedStartMs - pastMs;
    if (inputWindowStartMs < 0 || inputWindowEndMs > durationMs + 1e-6) {
      throw new Error('XC1_WINDOW_REAL_CONTEXT_UNAVAILABLE');
    }
    const startSample = Math.round(inputWindowStartMs * sampleRateHz / 1000);
    const endSample = startSample + inputSamples;
    windows.push({
      windowId: `owned_${Math.round(ownedStartMs)}`,
      ownedStartMs,
      ownedEndMs,
      inputWindowStartMs,
      inputWindowEndMs,
      startSample,
      endSample,
      shiftedFinalWindow,
    });
  }
  return windows;
}

function normalizeOutputShape(dims, data, name) {
  if (!Array.isArray(dims) && !ArrayBuffer.isView(dims)) {
    throw new Error(`XC1_ROBUST_${name}_DIMS_REQUIRED`);
  }
  const shape = Array.from(dims, Number);
  if (shape.length !== 2 && shape.length !== 3) {
    throw new Error(`XC1_ROBUST_${name}_RANK_INVALID`);
  }
  const frameCount = shape.length === 3 ? shape[1] : shape[0];
  const pitchCount = shape.length === 3 ? shape[2] : shape[1];
  if (shape.length === 3 && shape[0] !== 1) {
    throw new Error(`XC1_ROBUST_${name}_BATCH_INVALID`);
  }
  if (pitchCount !== 88) {
    throw new Error(`XC1_ROBUST_${name}_PITCH_COUNT_INVALID`);
  }
  if ((data?.length ?? 0) !== frameCount * pitchCount) {
    throw new Error(`XC1_ROBUST_${name}_DATA_LENGTH_INVALID`);
  }
  return { frameCount, pitchCount };
}

function valueAt(data, pitchCount, frameIndex, pitchIndex) {
  return Number(data[frameIndex * pitchCount + pitchIndex] ?? 0);
}

function sanitize(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, '_');
}
