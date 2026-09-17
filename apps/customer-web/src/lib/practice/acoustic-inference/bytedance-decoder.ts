import {
  BYTEDANCE_INFERENCE_CONTRACT,
  BYTEDANCE_OUTPUT_DESCRIPTORS,
  type AcousticNoteEvent,
  type ByteDancePcmInferenceRequest,
  type ByteDanceRawOutputs,
} from './bytedance-contract';

const MIDI_LOWEST_PIANO_KEY = 21;

export function decodeByteDanceRawOutputs(
  raw: ByteDanceRawOutputs,
  request: ByteDancePcmInferenceRequest,
  options: {
    inferenceCompletedAtMs?: number;
    onsetThreshold?: number;
    frameThreshold?: number;
  } = {}
): AcousticNoteEvent[] {
  const onset = normalizeOutputMatrix(
    raw.reg_onset_output,
    raw.reg_onset_shape,
    BYTEDANCE_OUTPUT_DESCRIPTORS.regOnset.name
  );
  const frame = normalizeOutputMatrix(
    raw.frame_output,
    raw.frame_shape,
    BYTEDANCE_OUTPUT_DESCRIPTORS.frame.name
  );
  if (onset.frameCount !== frame.frameCount || onset.pitchCount !== frame.pitchCount) {
    throw new Error('ByteDance onset/frame output shapes do not agree.');
  }
  const onsetThreshold = options.onsetThreshold ?? BYTEDANCE_INFERENCE_CONTRACT.onsetThreshold;
  const frameThreshold = options.frameThreshold ?? BYTEDANCE_INFERENCE_CONTRACT.frameThreshold;
  const events: AcousticNoteEvent[] = [];
  for (let pitchIndex = 0; pitchIndex < onset.pitchCount; pitchIndex += 1) {
    for (const peakFrameIndex of onsetPeakFramesForPitch(onset, pitchIndex, onsetThreshold)) {
      const onsetScore = onset.value(peakFrameIndex, pitchIndex);
      const frameScore = frame.value(peakFrameIndex, pitchIndex);
      if (frameScore < frameThreshold) {
        continue;
      }
      events.push(eventForPeak({
        request,
        pitchIndex,
        frameIndex: peakFrameIndex,
        onsetScore,
        frameScore,
        inferenceCompletedAtMs: options.inferenceCompletedAtMs,
      }));
    }
  }
  return events.sort((left, right) => (
    left.onsetTime.ms - right.onsetTime.ms || left.midiPitch - right.midiPitch
  ));
}

function onsetPeakFramesForPitch(
  onset: OutputMatrix,
  pitchIndex: number,
  onsetThreshold: number
): number[] {
  const peaks: number[] = [];
  let frameIndex = 0;
  while (frameIndex < onset.frameCount) {
    while (frameIndex < onset.frameCount && onset.value(frameIndex, pitchIndex) < onsetThreshold) {
      frameIndex += 1;
    }
    if (frameIndex >= onset.frameCount) {
      break;
    }
    let peakFrameIndex = frameIndex;
    let peakScore = onset.value(frameIndex, pitchIndex);
    while (frameIndex + 1 < onset.frameCount
      && onset.value(frameIndex + 1, pitchIndex) >= onsetThreshold) {
      frameIndex += 1;
      const score = onset.value(frameIndex, pitchIndex);
      if (score > peakScore) {
        peakScore = score;
        peakFrameIndex = frameIndex;
      }
    }
    peaks.push(peakFrameIndex);
    frameIndex += 1;
  }
  return peaks;
}

function eventForPeak(input: {
  request: ByteDancePcmInferenceRequest;
  pitchIndex: number;
  frameIndex: number;
  onsetScore: number;
  frameScore: number;
  inferenceCompletedAtMs?: number;
}): AcousticNoteEvent {
  const midiPitch = MIDI_LOWEST_PIANO_KEY + input.pitchIndex;
  const sampleOffset = Math.round(
    input.frameIndex / BYTEDANCE_INFERENCE_CONTRACT.outputFrameRateHz * input.request.sampleRateHz
  );
  const onsetSample = input.request.captureStartSampleIndex + sampleOffset;
  return {
    pitch: midiPitchToPitchName(midiPitch),
    midiPitch,
    onsetTime: {
      ...input.request.captureStartTime,
      ms: input.request.captureStartTime.ms + sampleOffset / input.request.sampleRateHz * 1000,
      sampleIndex: onsetSample,
    },
    confidence: Math.min(input.onsetScore, input.frameScore),
    onsetScore: input.onsetScore,
    frameScore: input.frameScore,
    source: 'ACOUSTIC',
    inferenceCompletedAtMs: input.inferenceCompletedAtMs,
  };
}

type OutputMatrix = ReturnType<typeof normalizeOutputMatrix>;

function normalizeOutputMatrix(data: Float32Array, shape: readonly number[], name: string) {
  if (shape.length !== 2 && shape.length !== 3) {
    throw new Error(`ByteDance output ${name} must be rank 2 or 3.`);
  }
  const frameCount = shape.length === 3 ? shape[1] : shape[0];
  const pitchCount = shape.length === 3 ? shape[2] : shape[1];
  if (shape.length === 3 && shape[0] !== 1) {
    throw new Error(`ByteDance output ${name} must have batch size 1.`);
  }
  if (pitchCount !== BYTEDANCE_OUTPUT_DESCRIPTORS.regOnset.pitchCount) {
    throw new Error(`ByteDance output ${name} must have 88 piano pitches.`);
  }
  if (data.length !== frameCount * pitchCount) {
    throw new Error(`ByteDance output ${name} data length does not match its shape.`);
  }
  return {
    frameCount,
    pitchCount,
    value(frameIndex: number, pitchIndex: number): number {
      return data[frameIndex * pitchCount + pitchIndex] ?? 0;
    },
  };
}

export function midiPitchToPitchName(midiPitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const name = names[midiPitch % 12];
  const octave = Math.floor(midiPitch / 12) - 1;
  return `${name}${octave}`;
}
