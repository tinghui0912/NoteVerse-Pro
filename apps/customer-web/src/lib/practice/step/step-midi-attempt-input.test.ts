import { describe, expect, it, vi } from 'vitest';
import type { StepAttemptIdentity } from './domain/attempt';
import { StepMidiAttemptInput, STEP_MIDI_CHORD_COHERENCE_MS } from './step-midi-attempt-input';

function setup() {
  const tasks: (() => void)[] = [];
  const open = vi.fn((time: { domainId: string; ms: number }): StepAttemptIdentity => ({ attemptId: 'attempt', localSessionId: 'midi',
    stepId: 'target', targetGeneration: 1, inputSource: 'MIDI', attemptStartSessionTime: time }));
  const complete = vi.fn(), failure = vi.fn(), cancel = vi.fn();
  const schedule = vi.fn((callback: () => void, _delay: number) => { tasks.push(callback); return callback; });
  const input = new StepMidiAttemptInput({ open, complete, failure }, { schedule, cancel });
  const note = (ms: number, pitch = 'C4', type: 'NOTE_ON' | 'NOTE_OFF' = 'NOTE_ON') => input.note({ type, pitch, noteNumber: 60, velocity: 80, sessionTime: { domainId: 'midi', ms } });
  return { input, open, complete, failure, tasks, schedule, cancel, note };
}
describe('score-blind MIDI pitch evidence', () => {
  it('waits without a NOTE_ON and does not synthesize an empty attempt', () => {
    const s = setup(); s.note(100,'C4','NOTE_OFF');
    expect(s.open).not.toHaveBeenCalled(); expect(s.complete).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled();
  });
  it('publishes one nonempty immutable pitch set at the first-NOTE_ON half-open 35ms boundary', () => {
    const s = setup(); s.note(100,'E4'); s.note(101,'C4'); s.note(120,'E4'); s.note(135,'G4'); s.note(500,'G4');
    expect(STEP_MIDI_CHORD_COHERENCE_MS).toBe(35);
    expect(s.schedule).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 35);
    expect(s.complete).not.toHaveBeenCalled(); s.tasks[0]();
    expect(s.complete).toHaveBeenCalledOnce();
    const [identity, evidence] = s.complete.mock.calls[0];
    expect(identity.attemptStartSessionTime.ms).toBe(100);
    expect(evidence).toEqual({ observedAttackPitches: ['C4','E4'], confidence: 1, captureEndSessionTime: { domainId: 'midi', ms: 135 } });
    expect(Object.keys(evidence).sort()).toEqual(['captureEndSessionTime','confidence','observedAttackPitches']);
    expect(Object.isFrozen(evidence)).toBe(true); expect(Object.isFrozen(evidence.observedAttackPitches)).toBe(true);
    expect(s.failure).not.toHaveBeenCalled();
  });
  it('cancels ownership without a late completion or fabricated evidence', () => {
    const s = setup(); s.note(100); s.input.cancel(); s.tasks[0]();
    expect(s.cancel).toHaveBeenCalledOnce(); expect(s.complete).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  });
  it('reports a consumer failure to the application instead of manufacturing another evidence outcome', () => {
    const s = setup(), error = new Error('consumer failure'); s.complete.mockImplementationOnce(() => { throw error; });
    s.note(100); s.tasks[0]();
    expect(s.complete).toHaveBeenCalledOnce(); expect(s.failure).toHaveBeenCalledExactlyOnceWith(error);
  });
});
