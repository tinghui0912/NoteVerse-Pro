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
