import { ACOUSTIC_MODEL, fail } from './model-contract';
import { PIANO_OUTPUT_FRAME_RATE_HZ, PIANO_PITCH_COUNT, type PianoRawOutputs } from './raw-output-contract';
import type { DecodedAcousticEvent } from '../runtime/inference-types';

/** Region peak (earliest on a tie), gated by support at that exact frame. */
export function decodeRobustPiano(raw: PianoRawOutputs, inputStartSample: number,
  thresholds: Readonly<{ onsetThreshold: number; frameThreshold: number }>): DecodedAcousticEvent[] {
  const onset = matrix(raw.reg_onset_output, raw.reg_onset_shape);
  const frame = matrix(raw.frame_output, raw.frame_shape);
  if (onset.frameCount !== frame.frameCount) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  const events: DecodedAcousticEvent[] = [];
  for (let pitchIndex = 0; pitchIndex < PIANO_PITCH_COUNT; pitchIndex++) {
    let index = 0;
    while (index < onset.frameCount) {
      while (index < onset.frameCount && onset.value(index, pitchIndex) < thresholds.onsetThreshold) index++;
      if (index >= onset.frameCount) break;
      let peak = index, peakScore = onset.value(index, pitchIndex);
      while (index + 1 < onset.frameCount && onset.value(index + 1, pitchIndex) >= thresholds.onsetThreshold) {
        index++;
        const score = onset.value(index, pitchIndex);
        if (score > peakScore) { peak = index; peakScore = score; }
      }
      index++;
      const frameScore = frame.value(peak, pitchIndex);
      if (frameScore < thresholds.frameThreshold) continue;
      const midiPitch = 21 + pitchIndex;
      const sampleOffset = Math.round(peak / PIANO_OUTPUT_FRAME_RATE_HZ * ACOUSTIC_MODEL.sampleRateHz);
      events.push(Object.freeze({ pitch: pianoMidiPitchToName(midiPitch), midiPitch, targetSample: inputStartSample + sampleOffset,
        confidence: Math.min(peakScore, frameScore), onsetScore: peakScore, frameScore }));
    }
  }
  return events.sort((a, b) => a.targetSample - b.targetSample || a.midiPitch - b.midiPitch);
}
function matrix(data: Float32Array, shape: readonly number[]) {
  if ((shape.length !== 2 && shape.length !== 3) || (shape.length === 3 && shape[0] !== 1)) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  const frameCount = shape.length === 3 ? shape[1] : shape[0];
  if (shape.at(-1) !== PIANO_PITCH_COUNT || !Number.isInteger(frameCount) || frameCount <= 0
    || data.length !== frameCount * PIANO_PITCH_COUNT) fail('ACOUSTIC_OUTPUT_DESCRIPTOR_MISMATCH');
  if (data.some(v => !Number.isFinite(v))) fail('ACOUSTIC_NONFINITE_OUTPUT');
  return { frameCount, value: (frame: number, pitch: number) => data[frame * PIANO_PITCH_COUNT + pitch] };
}
/** Canonical spelling for a validated qualified piano MIDI identity. */
export function pianoMidiPitchToName(midi: number): string {
  return `${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][midi % 12]}${Math.floor(midi / 12) - 1}`;
}
