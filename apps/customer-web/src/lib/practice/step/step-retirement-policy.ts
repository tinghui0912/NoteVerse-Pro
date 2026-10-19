import type { LocalClock, PracticeTimebase, SessionTime } from '../local-core/timebase';

/** Input owners establish safe physical coverage; only the runtime commits progression. */
export interface StepRetirementPolicy {
  retirementWatermark(): Readonly<SessionTime> | null;
}

/** MIDI timestamps and the READY transition share the same PracticeTimebase. No cooldown. */
export class MidiStepRetirementPolicy implements StepRetirementPolicy {
  constructor(private readonly clock: LocalClock, private readonly timebase: PracticeTimebase) {}
  retirementWatermark(): Readonly<SessionTime> {
    return this.timebase.runtimeToSessionTime(this.clock.nowMs());
  }
}

/** Contract only, not a microphone implementation or a qualified delay value. */
export interface FutureMicrophoneRetirementContract extends StepRetirementPolicy {
  readonly minimumPostVerdict: 'MICROPHONE_POST_VERDICT_MINIMUM_NOT_YET_ENGINEERING_QUALIFIED';
  // A future owner returns capturedThrough only after its qualified retirement condition.
  // Capture continues; source event time <= that watermark is permanently retired.
}
