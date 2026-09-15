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
  for (let frameIndex = 0; frameIndex < onset.frameCount; frameIndex += 1) {
    for (let pitchIndex = 0; pitchIndex < onset.pitchCount; pitchIndex += 1) {
      const onsetScore = onset.value(frameIndex, pitchIndex);
      if (onsetScore < onsetThreshold) {
        continue;
      }
      const frameScore = frame.value(frameIndex, pitchIndex);
      if (frameScore < frameThreshold) {
        continue;
      }
      const midiPitch = MIDI_LOWEST_PIANO_KEY + pitchIndex;
      const sampleOffset = Math.round(
        frameIndex / BYTEDANCE_INFERENCE_CONTRACT.outputFrameRateHz * request.sampleRateHz
      );
      const onsetSample = request.captureStartSampleIndex + sampleOffset;
      events.push({
        pitch: midiPitchToPitchName(midiPitch),
        midiPitch,
        onsetTime: {
          ...request.captureStartTime,
          ms: request.captureStartTime.ms + sampleOffset / request.sampleRateHz * 1000,
          sampleIndex: onsetSample,
        },
        confidence: Math.min(onsetScore, frameScore),
        onsetScore,
        frameScore,
        source: 'ACOUSTIC',
        inferenceCompletedAtMs: options.inferenceCompletedAtMs,
      });
    }
  }
  return events;
}

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
