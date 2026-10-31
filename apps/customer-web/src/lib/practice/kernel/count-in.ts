import type { MeterSegment, PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

export type CountInContract = {
  durationBeats: number;
  pulses: number;
  numerator: number;
  denominator: number;
};

function meterAt(artifact: PracticeScoreArtifact, beat: number): MeterSegment {
  const segments = artifact.meterSegments;
  if (!segments.length || segments[0].startBeat !== 0) throw new Error('Admitted initial meter timing required.');
  let active = segments[0];
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
