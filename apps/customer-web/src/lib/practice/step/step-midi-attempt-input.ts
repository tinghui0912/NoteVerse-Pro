import type { SessionTime } from '../local-core/timebase';
import type { StepAttemptEvidence, StepAttemptIdentity } from '../local-core/step-attempt';
import type { MidiNoteFact } from '../midi/browser-midi-controller';

export const STEP_MIDI_CHORD_COHERENCE_MS = 35;
export interface StepGestureTimer {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}
export type StepMidiAttemptSink = Readonly<{
  open(time: SessionTime): StepAttemptIdentity | null;
  complete(identity: StepAttemptIdentity, evidence: StepAttemptEvidence): void;
  failure(error: unknown): void;
}>;
/** Fixed first-NOTE_ON window, never extended or closed early by target content. */
export class StepMidiAttemptInput {
  private active: { identity: StepAttemptIdentity; pitches: Set<string>; end: SessionTime } | null = null;
  private handle: unknown = null;
  private epoch = 0;
  private ignored = 0;
  constructor(private readonly sink: StepMidiAttemptSink, private readonly timer: StepGestureTimer) {}
  note(note: MidiNoteFact): void {
    if (note.type !== 'NOTE_ON') return;
    try {
      if (this.active) {
        // Delayed timers do not turn the gesture into an unbounded bag.
        if (note.sessionTime.domainId !== this.active.end.domainId || note.sessionTime.ms < this.active.identity.attemptStartSessionTime.ms
          || note.sessionTime.ms >= this.active.end.ms) { this.ignore(); return; }
        if (!this.active.pitches.has(note.pitch) && this.active.pitches.size >= 128) throw new Error('STEP_ATTEMPT_PITCH_LIMIT_EXCEEDED');
        this.active.pitches.add(note.pitch); return;
      }
      const identity = this.sink.open(note.sessionTime);
      if (!identity) { this.ignore(); return; }
      const epoch = ++this.epoch;
      this.active = { identity, pitches: new Set([note.pitch]), end: { ...note.sessionTime, ms: note.sessionTime.ms + STEP_MIDI_CHORD_COHERENCE_MS } };
      this.handle = this.timer.schedule(() => {
        if (epoch !== this.epoch || !this.active) return;
        const gesture = this.active; this.active = null; this.handle = null;
        try { this.sink.complete(gesture.identity, Object.freeze({ kind: 'EVIDENCE', confidence: 1,
          observedAttackPitches: Object.freeze([...gesture.pitches].sort()), captureEndSessionTime: Object.freeze(gesture.end) })); }
        catch (error) { this.sink.failure(error); }
      }, STEP_MIDI_CHORD_COHERENCE_MS);
    } catch (error) { this.cancel(); this.sink.failure(error); }
  }
  cancel(): void {
    this.epoch++; if (this.handle !== null) this.timer.cancel(this.handle);
    this.handle = null; this.active = null;
  }
  snapshot() { return Object.freeze({ capturing: this.active !== null, retainedPitchCount: this.active?.pitches.size ?? 0, ignoredNotes: this.ignored }); }
  private ignore(): void { this.ignored = Math.min(Number.MAX_SAFE_INTEGER, this.ignored + 1); }
}
