import { describe, expect, it, vi } from 'vitest';
import fixture from '../local-core/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact, PracticeScope } from '../local-core/artifact';
import { ManualClock } from '../local-core/timebase';
import type { BrowserMidiControllerOptions } from '../midi/browser-midi-controller';
import { StepPracticeController } from './step-practice-controller';
import type { StepPlatform } from './step-platform';
import { STEP_MIDI_GESTURE_MS } from './step-midi-attempt-input';

const artifact = fixture as PracticeScoreArtifact;
function setup(index = 0, inputSource: 'MIDI' | 'MICROPHONE' = 'MIDI', delayed = false) {
  const clock = new ManualClock(100), timers: { callback(): void; delay: number; cancelled: boolean }[] = [];
  let options: BrowserMidiControllerOptions;
  let connected = 1, running = false;
  let resolveStart: () => void = () => {};
  const midi = { start: vi.fn(async () => { if (delayed) await new Promise<void>(resolve => { resolveStart = resolve; }); running = true; }),
    stop: vi.fn(() => { running = false; }), dispose: vi.fn(() => { running = false; }),
    getState: () => ({ isSupported: true, hasPermission: true, connectedInputCount: connected, isRunning: running }) };
  const metronome = { start: vi.fn(), pause: vi.fn(), resume: vi.fn(), destroy: vi.fn(), setEnabled: vi.fn(), setStepContext: vi.fn() };
  const platform: StepPlatform = { clock, timer: {
    schedule: (callback, delay) => { const task = { callback, delay, cancelled: false }; timers.push(task); return task; },
    cancel: handle => { (handle as typeof timers[number]).cancelled = true; },
  }, createMidi: value => { options = value; return midi; }, createMetronome: () => metronome };
  const scope: PracticeScope = { kind: 'RANGE', startGroupId: artifact.expectedPracticeGroups[index].groupId,
    endGroupId: artifact.expectedPracticeGroups.at(-1)!.groupId };
  const completion = vi.fn();
  const create = () => new StepPracticeController({ artifact, scope, inputSource, platform, onCompletion: completion });
  const controller = create();
  const note = (pitch: string, type: 'NOTE_ON' | 'NOTE_OFF' = 'NOTE_ON', ms = clock.nowMs()) => {
    options.onMidiNote?.({ type, pitch, velocity: 80, noteNumber: 60, sessionTime: options.timebase.atSessionMs(ms) });
  };
  const close = () => { const task = timers.at(-1)!; clock.advance(35); if (!task.cancelled) task.callback(); };
  const disconnect = () => { connected = 0; options.onStateChange?.(midi.getState()); };
  return { controller, create, clock, timers, midi, metronome, completion, note, close, disconnect,
    resolveStart: () => resolveStart(), options: () => options };
}
describe('STEP application owner / bounded MIDI gesture', () => {
  it.each([
    [0, ['C4'], 'MATCH'], [0, ['C#4'], 'MISMATCH'], [0, ['C5'], 'MISMATCH'],
    [3, ['A4', 'C5'], 'MATCH'], [3, ['A4'], 'MISMATCH'], [3, ['A4', 'C5', 'D5'], 'MISMATCH'],
  ] as const)('target %s closes full gesture %j before %s', async (index, pitches, verdict) => {
    const s = setup(index); await s.controller.start();
    pitches.forEach(p => s.note(p));
    expect(s.controller.snapshot().sessionSnapshot?.step.attempts).toHaveLength(0);
    expect(s.controller.snapshot().sessionSnapshot?.step.attemptState).toBe('CAPTURING');
    expect(s.timers).toHaveLength(1); expect(s.timers[0].delay).toBe(STEP_MIDI_GESTURE_MS);
    s.close(); const snapshot = s.controller.snapshot().sessionSnapshot!;
    expect(snapshot.step.attempts[0].verdict).toBe(verdict);
    expect(snapshot.step.currentIndex).toBe(index + (verdict === 'MATCH' ? 1 : 0));
    expect(snapshot.step.attemptState).toBe('READY');
    s.timers[0].callback(); expect(s.controller.snapshot().sessionSnapshot?.step.attempts).toHaveLength(1);
    s.controller.dispose();
  });
  it('near-simultaneous extra pitch cannot follow an early correct chord acceptance', async () => {
    const s = setup(3); await s.controller.start(); s.note('A4'); s.note('C5', 'NOTE_ON', 110);
    expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(3);
    s.note('D5', 'NOTE_ON', 134); s.close();
    expect(s.controller.snapshot().sessionSnapshot?.step.attempts[0].verdict).toBe('MISMATCH');
    s.controller.dispose();
  });
  it('fixed first-note window is not extended by later notes or delayed timers', async () => {
    const s = setup(3); await s.controller.start(); s.note('A4'); s.note('C5', 'NOTE_ON', 135); s.note('D5', 'NOTE_ON', 500);
    expect(s.timers).toHaveLength(1); s.close();
    expect(s.controller.snapshot().sessionSnapshot?.step.attempts[0].observedAttackPitches).toEqual(['A4']);
    expect(s.controller.snapshot().inputDiagnostics?.ignoredNotes).toBe(2); s.controller.dispose();
  });
  it('multiple wrong attempts then correct each close separately; metronome target changes only after MATCH', async () => {
    const s = setup(); await s.controller.start();
    const contexts = s.metronome.setStepContext.mock.calls.length;
    for (const p of ['C#4', 'C5', 'C4']) { s.note(p); s.close(); }
    expect(s.controller.snapshot().sessionSnapshot?.step.attempts.map(r => r.verdict)).toEqual(['MISMATCH', 'MISMATCH', 'MATCH']);
    expect(s.metronome.setStepContext.mock.calls.length).toBe(contexts + 1); s.controller.dispose();
  });
  it('partial then later full chord does not reuse the previous gesture', async () => {
    const s = setup(3); await s.controller.start(); s.note('A4'); s.close(); s.note('C5'); s.close();
    expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(3);
    s.note('A4'); s.note('C5'); s.close(); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(4);
    s.controller.dispose();
  });
  it('held note cannot advance next repeated target, fresh NOTE_ON can', async () => {
    const s = setup(); await s.controller.start(); s.note('C4'); s.close();
    s.note('C4', 'NOTE_OFF'); expect(s.timers).toHaveLength(1);
    expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(1);
    s.note('C4'); s.close(); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(2); s.controller.dispose();
  });
  it.each(['pause', 'skip', 'finish', 'disconnect', 'dispose'] as const)('%s cancels capturing, including stale timer callback', async command => {
    const s = setup(); await s.controller.start(); s.note('C4'); const callback = s.timers[0].callback;
    if (command === 'disconnect') s.disconnect(); else s.controller[command]();
    const after = s.controller.snapshot(); callback();
    expect(s.controller.snapshot().sessionSnapshot?.step).toEqual(after.sessionSnapshot?.step);
    expect(after.sessionSnapshot?.step.attempts).toHaveLength(0);
    if (command === 'disconnect') expect(after).toMatchObject({ state: 'PAUSED', error: 'NO_CONNECTED_INPUT' });
    s.controller.dispose();
  });
  it('resume creates new generation; cancelled callback cannot consume new attempt', async () => {
    const s = setup(); await s.controller.start(); s.note('C4'); const first = s.controller.snapshot().sessionSnapshot!.step.activeAttempt!;
    s.controller.pause(); await s.controller.resume(); s.note('C4');
    const next = s.controller.snapshot().sessionSnapshot!.step.activeAttempt!;
    expect(next.activationGeneration).toBeGreaterThan(first.activationGeneration);
    s.timers[0].callback(); expect(s.controller.snapshot().sessionSnapshot?.step.attempts).toHaveLength(0);
    s.close(); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(1); s.controller.dispose();
  });
  it('ANALYZING/RESET input is ignored, never queued for the next target', async () => {
    const s = setup(); await s.controller.start();
    const states: string[] = [];
    s.controller.subscribe(() => {
      const state = s.controller.snapshot().sessionSnapshot?.step.attemptState;
      if (state === 'ANALYZING' || state === 'RESET') { states.push(state); s.note('C4'); }
    });
    s.note('C4'); s.close();
    expect(states).toEqual(['ANALYZING', 'RESET']);
    expect(s.timers).toHaveLength(1); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(1);
    expect(s.controller.snapshot().inputDiagnostics?.ignoredNotes).toBe(2); s.controller.dispose();
  });
  it('finish and disposal release resources exactly once, before completion notification', async () => {
    const s = setup(4); await s.controller.start(); s.note('D5'); s.close();
    expect(s.controller.snapshot().state).toBe('ENDED'); expect(s.completion).toHaveBeenCalledTimes(1);
    expect(s.midi.dispose).toHaveBeenCalledTimes(1); expect(s.metronome.destroy).toHaveBeenCalledTimes(1);
    s.controller.finish(); s.controller.dispose(); s.controller.dispose();
    expect(s.midi.dispose).toHaveBeenCalledTimes(1); expect(s.metronome.destroy).toHaveBeenCalledTimes(1);
  });
  it('dispose during preparation cancels late start and emits no successful session', async () => {
    const s = setup(0, 'MIDI', true), pending = s.controller.start(); s.controller.dispose(); s.resolveStart(); await pending;
    expect(s.controller.snapshot().state).toBe('DISPOSED'); expect(s.completion).not.toHaveBeenCalled();
    expect(s.midi.dispose).toHaveBeenCalledTimes(1);
  });
  it('fresh owner uses a fresh session and no old timer can advance it', async () => {
    const s = setup(); await s.controller.start(); s.note('C4'); const old = s.controller.snapshot().sessionSnapshot!;
    s.controller.dispose(); const fresh = s.create(); await fresh.start(); s.timers[0].callback();
    expect(fresh.snapshot().sessionSnapshot?.localSessionId).not.toBe(old.localSessionId);
    expect(fresh.snapshot().sessionSnapshot?.step.currentIndex).toBe(0); fresh.dispose();
  });
  it('microphone start rejected without constructing MIDI/metronome or acoustic resources', async () => {
    const s = setup(0, 'MICROPHONE'); await s.controller.start();
    expect(s.controller.snapshot()).toMatchObject({ state: 'READY', error: 'STEP_ANALYSIS_UNAVAILABLE', sessionSnapshot: null });
    expect(s.midi.start).not.toHaveBeenCalled(); expect(s.metronome.start).not.toHaveBeenCalled(); s.controller.dispose();
  });
});
