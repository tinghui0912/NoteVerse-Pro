import { describe, expect, it, vi } from 'vitest';
import type { StepAttemptIdentity } from './domain/attempt';
import { parseMidiMessage } from '../midi/browser-midi-controller';
import { StepMidiAttemptInput, STEP_MIDI_CHORD_COHERENCE_MS } from './step-midi-attempt-input';

function setup() {
  const tasks: (() => void)[] = [];
  const open = vi.fn((time: { domainId: string; ms: number }): StepAttemptIdentity => ({ attemptId: 'attempt', localSessionId: 'midi',
    stepId: 'target', targetGeneration: 1, inputSource: 'MIDI', attemptStartSessionTime: time }));
  const complete = vi.fn(), failure = vi.fn(), cancel = vi.fn();
  const schedule = vi.fn((callback: () => void, _delay: number) => { tasks.push(callback); return callback; });
  const input = new StepMidiAttemptInput({ open, complete, failure }, { schedule, cancel });
  const note = (ms: number, pianoKey = 60, type: 'NOTE_ON' | 'NOTE_OFF' = 'NOTE_ON') => {
    const noteNumber = pianoKey;
    const parsed = parseMidiMessage(new Uint8Array([type === 'NOTE_ON' ? 0x90 : 0x80, noteNumber, 80]))!;
    input.note({ ...parsed, sessionTime: { domainId: 'midi', ms } });
  };
  return { input, open, complete, failure, tasks, schedule, cancel, note };
}
describe('score-blind MIDI pianoKey evidence', () => {
  it('waits without a NOTE_ON and does not synthesize an empty attempt', () => {
    const s = setup(); s.note(100,60,'NOTE_OFF');
    expect(s.open).not.toHaveBeenCalled(); expect(s.complete).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled();
  });
  it('publishes one nonempty immutable pianoKey set at the first-NOTE_ON half-open 35ms boundary', () => {
    const s = setup(); s.note(100,64); s.note(101,60); s.note(120,64); s.note(135,67); s.note(500,67);
    expect(STEP_MIDI_CHORD_COHERENCE_MS).toBe(35);
    expect(s.schedule).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 35);
    expect(s.complete).not.toHaveBeenCalled(); s.tasks[0]();
    expect(s.complete).toHaveBeenCalledOnce();
    const [identity, evidence] = s.complete.mock.calls[0];
    expect(identity.attemptStartSessionTime.ms).toBe(100);
    expect(evidence).toEqual({ observedAttackKeys: [60,64], confidence: 1, captureEndSessionTime: { domainId: 'midi', ms: 135 } });
    expect(Object.keys(evidence).sort()).toEqual(['captureEndSessionTime','confidence','observedAttackKeys']);
    expect(Object.isFrozen(evidence)).toBe(true); expect(Object.isFrozen(evidence.observedAttackKeys)).toBe(true);
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

it('filters the wire universe to all 88 Practice keys without losing in-domain attacks', () => {
  const s = setup();
  const facts = Array.from({ length: 128 }, (_, n) => parseMidiMessage(new Uint8Array([0x90, n, 80]))!);
  expect(new Set(facts.map(note => note.noteNumber)).size).toBe(facts.length);
  for (const fact of facts) s.input.note({ ...fact, sessionTime: { domainId: 'midi', ms: 100 } });
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedKeyCount: 88 });
  expect(s.open).toHaveBeenCalledOnce(); expect(s.schedule).toHaveBeenCalledOnce();
  expect(s.complete).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  s.input.note({ ...facts[60], sessionTime: { domainId: 'midi', ms: 101 } });
  expect(s.input.snapshot().retainedKeyCount).toBe(88);
  expect(s.failure).not.toHaveBeenCalled(); expect(s.complete).not.toHaveBeenCalled();
  s.tasks[0]();
  expect(s.complete).toHaveBeenCalledOnce();
  const evidence = s.complete.mock.calls[0][1];
  expect(evidence).toEqual({ observedAttackKeys: facts.filter(note => note.noteNumber >= 21 && note.noteNumber <= 108).map(note => note.noteNumber), confidence: 1,
    captureEndSessionTime: { domainId: 'midi', ms: 100 + STEP_MIDI_CHORD_COHERENCE_MS } });
  expect(Object.isFrozen(evidence.observedAttackKeys)).toBe(true);
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedKeyCount: 0 });
});

const malformedNoteOnIdentities = [
  { reason: 'negative note number', noteNumber: -1},
  { reason: 'above-wire note number', noteNumber: 128},
  { reason: 'fractional note number', noteNumber: 60.5},
];
it.each(malformedNoteOnIdentities)('rejects malformed $reason before opening or retaining an inactive gesture', fact => {
  const s = setup();
  s.input.note({ ...fact, type: 'NOTE_ON', velocity: 80, sessionTime: { domainId: 'midi', ms: 100 } });
  expect(s.open).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled(); expect(s.cancel).not.toHaveBeenCalled();
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedKeyCount: 0 });
  expect(s.complete).not.toHaveBeenCalled();
  expect(s.failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'STEP_ATTEMPT_EVIDENCE_INVALID' }));
});
it.each(malformedNoteOnIdentities)('cancels active ownership on malformed $reason and fences the old timer', fact => {
  const s = setup(); s.note(100);
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedKeyCount: 1 });
  s.input.note({ ...fact, type: 'NOTE_ON', velocity: 80, sessionTime: { domainId: 'midi', ms: 101 } });
  expect(s.cancel).toHaveBeenCalledExactlyOnceWith(s.tasks[0]);
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedKeyCount: 0 });
  expect(s.open).toHaveBeenCalledOnce(); expect(s.schedule).toHaveBeenCalledOnce(); expect(s.complete).not.toHaveBeenCalled();
  expect(s.failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'STEP_ATTEMPT_EVIDENCE_INVALID' }));
  s.tasks[0]();
  expect(s.complete).not.toHaveBeenCalled(); expect(s.failure).toHaveBeenCalledOnce();
  expect(s.input.snapshot()).toMatchObject({ capturing: false, retainedKeyCount: 0 });
});
it('continues ignoring NOTE_OFF even when its direct-call identity is malformed', () => {
  const s = setup();
  const off = { type: 'NOTE_OFF' as const, noteNumber: -1, velocity: 0, sessionTime: { domainId: 'midi', ms: 100 } };
  s.input.note(off);
  expect(s.open).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  s.note(100); s.input.note(off);
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedKeyCount: 1 });
  expect(s.cancel).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  s.tasks[0](); expect(s.complete.mock.calls[0][1].observedAttackKeys).toEqual([60]);
});
it('does not introduce velocity validation for an identity-consistent direct NOTE_ON', () => {
  const s = setup();
  s.input.note({ type: 'NOTE_ON', noteNumber: 60, velocity: 0, sessionTime: { domainId: 'midi', ms: 100 } });
  expect(s.input.snapshot()).toMatchObject({ capturing: true, retainedKeyCount: 1 });
  s.tasks[0](); expect(s.complete).toHaveBeenCalledOnce(); expect(s.failure).not.toHaveBeenCalled();
});

it('retains the validated pianoKey snapshot when the opening callback mutates the caller fact', () => {
  const s = setup();
  const fact = { type: 'NOTE_ON' as const, noteNumber: 60, velocity: 80, sessionTime: { domainId: 'midi', ms: 100 } };
  s.open.mockImplementationOnce(time => {
    fact.noteNumber = 64;
    return { attemptId: 'attempt', localSessionId: 'midi', stepId: 'target', targetGeneration: 1, inputSource: 'MIDI', attemptStartSessionTime: time };
  });
  s.input.note(fact); s.tasks[0]();
  expect(s.complete.mock.calls[0][1].observedAttackKeys).toEqual([60]);
  expect(s.failure).not.toHaveBeenCalled();
});

it('ignores out-of-Practice wire notes before opening a gesture; both piano endpoints pass', () => {
  const s = setup();
  s.note(100, 20); s.note(100, 109);
  expect(s.open).not.toHaveBeenCalled(); expect(s.schedule).not.toHaveBeenCalled(); expect(s.failure).not.toHaveBeenCalled();
  s.note(100, 21); s.note(101, 108); s.note(102, 20); s.note(103, 109); s.tasks[0]();
  expect(s.complete.mock.calls[0][1].observedAttackKeys).toEqual([21, 108]);
  expect(s.failure).not.toHaveBeenCalled();
});
