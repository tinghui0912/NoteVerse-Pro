import { describe, expect, it, vi } from 'vitest';
import type { StepAttemptIdentity } from './domain/attempt';
import { midiNoteToPitch, parseMidiMessage } from '../midi/browser-midi-controller';
import { StepMidiAttemptInput, STEP_MIDI_CHORD_COHERENCE_MS } from './step-midi-attempt-input';

function setup() {
  const tasks: (() => void)[] = [];
  const open = vi.fn((time: { domainId: string; ms: number }): StepAttemptIdentity => ({ attemptId: 'attempt', localSessionId: 'midi',
    stepId: 'target', targetGeneration: 1, inputSource: 'MIDI', attemptStartSessionTime: time }));
  const complete = vi.fn(), failure = vi.fn(), cancel = vi.fn();
  const schedule = vi.fn((callback: () => void, _delay: number) => { tasks.push(callback); return callback; });
  const input = new StepMidiAttemptInput({ open, complete, failure }, { schedule, cancel });
  const note = (ms: number, pitch = 'C4', type: 'NOTE_ON' | 'NOTE_OFF' = 'NOTE_ON') => {
    const noteNumber = Array.from({ length: 128 }, (_, n) => n).find(n => midiNoteToPitch(n) === pitch);
    if (noteNumber === undefined) throw new Error(`Invalid MIDI fixture pitch: ${pitch}`);
    const parsed = parseMidiMessage(new Uint8Array([type === 'NOTE_ON' ? 0x90 : 0x80, noteNumber, 80]))!;
    input.note({ ...parsed, sessionTime: { domainId: 'midi', ms } });
  };
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

it('retains every parser-produced MIDI identity once and accepts the 129th event as a bounded duplicate', () => {
  const s = setup();
  const facts = Array.from({ length: 128 }, (_, n) => parseMidiMessage(new Uint8Array([0x90, n, 80]))!);
  expect(new Set(facts.map(note => note.pitch)).size).toBe(facts.length);
  for (const fact of facts) s.input.note({ ...fact, sessionTime: { domainId: 'midi', ms: 100 } });
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedPitchCount: facts.length });
  expect(s.open).toHaveBeenCalledOnce(); expect(s.schedule).toHaveBeenCalledOnce();
  expect(s.complete).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  s.input.note({ ...facts[60], sessionTime: { domainId: 'midi', ms: 101 } });
  expect(s.input.snapshot().retainedPitchCount).toBe(128);
  expect(s.failure).not.toHaveBeenCalled(); expect(s.complete).not.toHaveBeenCalled();
  s.tasks[0]();
  expect(s.complete).toHaveBeenCalledOnce();
  const evidence = s.complete.mock.calls[0][1];
  expect(evidence).toEqual({ observedAttackPitches: facts.map(note => note.pitch).sort(), confidence: 1,
    captureEndSessionTime: { domainId: 'midi', ms: 100 + STEP_MIDI_CHORD_COHERENCE_MS } });
  expect(Object.isFrozen(evidence.observedAttackPitches)).toBe(true);
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedPitchCount: 0 });
});

const malformedNoteOnIdentities = [
  { reason: 'mismatched pitch', noteNumber: 60, pitch: 'E4' },
  { reason: 'negative note number', noteNumber: -1, pitch: 'C4' },
  { reason: 'above-wire note number', noteNumber: 128, pitch: 'C4' },
  { reason: 'fractional note number', noteNumber: 60.5, pitch: 'C4' },
];
it.each(malformedNoteOnIdentities)('rejects malformed $reason before opening or retaining an inactive gesture', fact => {
  const s = setup();
  s.input.note({ ...fact, type: 'NOTE_ON', velocity: 80, sessionTime: { domainId: 'midi', ms: 100 } });
  expect(s.open).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled(); expect(s.cancel).not.toHaveBeenCalled();
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedPitchCount: 0 });
  expect(s.complete).not.toHaveBeenCalled();
  expect(s.failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'STEP_ATTEMPT_EVIDENCE_INVALID' }));
});
it.each(malformedNoteOnIdentities)('cancels active ownership on malformed $reason and fences the old timer', fact => {
  const s = setup(); s.note(100);
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedPitchCount: 1 });
  s.input.note({ ...fact, type: 'NOTE_ON', velocity: 80, sessionTime: { domainId: 'midi', ms: 101 } });
  expect(s.cancel).toHaveBeenCalledExactlyOnceWith(s.tasks[0]);
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedPitchCount: 0 });
  expect(s.open).toHaveBeenCalledOnce(); expect(s.schedule).toHaveBeenCalledOnce(); expect(s.complete).not.toHaveBeenCalled();
  expect(s.failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'STEP_ATTEMPT_EVIDENCE_INVALID' }));
  s.tasks[0]();
  expect(s.complete).not.toHaveBeenCalled(); expect(s.failure).toHaveBeenCalledOnce();
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedPitchCount: 0 });
});
it('continues ignoring NOTE_OFF even when its direct-call identity is malformed', () => {
  const s = setup();
  const off = { type: 'NOTE_OFF' as const, noteNumber: -1, pitch: 'not-a-pitch', velocity: 0, sessionTime: { domainId: 'midi', ms: 100 } };
  s.input.note(off);
  expect(s.open).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  s.note(100); s.input.note(off);
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedPitchCount: 1 });
  expect(s.cancel).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  s.tasks[0](); expect(s.complete.mock.calls[0][1].observedAttackPitches).toEqual(['C4']);
});
it('does not introduce velocity validation for an identity-consistent direct NOTE_ON', () => {
  const s = setup();
  s.input.note({ type: 'NOTE_ON', noteNumber: 60, pitch: 'C4', velocity: 0, sessionTime: { domainId: 'midi', ms: 100 } });
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedPitchCount: 1 });
  s.tasks[0](); expect(s.complete).toHaveBeenCalledOnce(); expect(s.failure).not.toHaveBeenCalled();
});

it('retains the validated pitch snapshot when the opening callback mutates the caller fact', () => {
  const s = setup();
  const fact = { type: 'NOTE_ON' as const, noteNumber: 60, pitch: 'C4', velocity: 80, sessionTime: { domainId: 'midi', ms: 100 } };
  s.open.mockImplementationOnce(time => {
    fact.pitch = 'E4';
    return { attemptId: 'attempt', localSessionId: 'midi', stepId: 'target', targetGeneration: 1, inputSource: 'MIDI', attemptStartSessionTime: time };
  });
  s.input.note(fact); s.tasks[0]();
  expect(s.complete.mock.calls[0][1].observedAttackPitches).toEqual(['C4']);
  expect(s.failure).not.toHaveBeenCalled();
});
