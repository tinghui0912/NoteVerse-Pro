import { scoreTick } from '@/lib/practice/score/score-time';
import { measureDurationTicks, type MeterSegment, type PracticeScoreArtifact } from '@/lib/practice/score/artifact';

export type CountInContract = {
  durationTicks: number;
  pulses: number;
  numerator: number;
  denominator: number;
};

function meterAt(artifact: PracticeScoreArtifact, tick: number): MeterSegment {
  scoreTick(tick);
  const segments = artifact.meterSegments;
  if (!segments.length || segments[0].startTick !== 0) throw new Error('Admitted initial meter timing required.');
  let active = segments[0];
  for (const segment of segments) {
    if (segment.startTick > tick) {
      break;
    }
    active = segment;
  }
  return active;
}

/** Current Count-In policy uses one pulse per denominator unit. */
export function countInContractAt(artifact: PracticeScoreArtifact, tick: number): CountInContract {
  const meter = meterAt(artifact, tick);
  return {
    durationTicks: measureDurationTicks(meter, artifact.ticksPerQuarter),
    pulses: meter.numerator,
    numerator: meter.numerator,
    denominator: meter.denominator,
  };
}
