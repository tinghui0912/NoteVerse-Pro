import type { AcousticNoteEvent } from './bytedance-contract';

export type AcousticEventStreamNormalizerOptions = {
  sampleRateHz: number;
  eventDedupeSeconds?: number;
};

export class AcousticEventStreamNormalizer {
  private readonly dedupeSamples: number;
  private readonly lastEmittedSampleByPitch = new Map<string, number>();

  constructor(options: AcousticEventStreamNormalizerOptions) {
    if (options.sampleRateHz <= 0) {
      throw new Error('Acoustic event stream normalization requires a positive sample rate.');
    }
    this.dedupeSamples = Math.round((options.eventDedupeSeconds ?? 0.050) * options.sampleRateHz);
  }

  normalizeWindow(events: readonly AcousticNoteEvent[]): AcousticNoteEvent[] {
    const emitted: AcousticNoteEvent[] = [];
    for (const event of [...events].sort(compareEventsBySample)) {
      const sampleIndex = event.onsetTime.sampleIndex;
      if (sampleIndex === undefined) {
        throw new Error('Acoustic event stream normalization requires capture sample identity.');
      }
      const previous = this.lastEmittedSampleByPitch.get(event.pitch);
      if (previous !== undefined && sampleIndex - previous <= this.dedupeSamples) {
        continue;
      }
      this.lastEmittedSampleByPitch.set(event.pitch, sampleIndex);
      emitted.push(event);
    }
    return emitted;
  }

  reset(): void {
    this.lastEmittedSampleByPitch.clear();
  }
}

function compareEventsBySample(left: AcousticNoteEvent, right: AcousticNoteEvent): number {
  const leftSample = left.onsetTime.sampleIndex;
  const rightSample = right.onsetTime.sampleIndex;
  if (leftSample === undefined || rightSample === undefined) {
    return left.onsetTime.ms - right.onsetTime.ms || left.midiPitch - right.midiPitch;
  }
  return leftSample - rightSample || left.midiPitch - right.midiPitch;
}
