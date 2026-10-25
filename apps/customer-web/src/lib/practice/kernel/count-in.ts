import type { MeterSegment, PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

export type CountInContract = {
  durationBeats: number;
  pulses: number;
  numerator: number;
  denominator: number;
};

function meterAt(artifact: PracticeScoreArtifact, beat: number): MeterSegment {
  const defaultMeter: MeterSegment = {
    startBeat: 0,
    numerator: 4,
    denominator: 4,
    measureDurationBeats: 4,
    countInPulses: 4,
    source: 'DEFAULT_4_4',
  };
  const segments = artifact.meterSegments && artifact.meterSegments.length > 0 ? artifact.meterSegments : [defaultMeter];
  let active = segments[0] ?? defaultMeter;
  for (const segment of segments) {
    if (segment.startBeat > beat) {
      break;
    }
    active = segment;
  }
  return active;
}

export function countInContractAt(artifact: PracticeScoreArtifact, beat: number): CountInContract {
  const meter = meterAt(artifact, beat);
  return {
    durationBeats: meter.measureDurationBeats,
    pulses: meter.countInPulses,
    numerator: meter.numerator,
    denominator: meter.denominator,
  };
}
