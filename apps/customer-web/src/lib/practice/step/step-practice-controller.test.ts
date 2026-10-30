import type { PracticePianoKey } from '@/lib/practice/kernel/piano-key';
import { borrowedDevices } from '@/lib/practice/__fixtures__/device-roots';
import type { StepAttemptRecord } from './domain/attempt';
import { describe, expect, it, vi } from 'vitest';
import fixture from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { type PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import type { PracticeScope } from '@/lib/practice/kernel/scope';
import { ManualClock } from '@/lib/practice/kernel/timebase';
import { parseMidiMessage, type BrowserMidiControllerOptions } from '../midi/browser-midi-controller';
import { StepPracticeController } from './step-practice-controller';
import type { StepPlatform } from './step-platform';
import { STEP_MIDI_CHORD_COHERENCE_MS } from './step-midi-attempt-input';

const artifact = fixture as PracticeScoreArtifact;

function setup(index = 0, inputSource: 'MIDI' | 'MICROPHONE' = 'MIDI', delayed = false, selectedArtifact = artifact) {
  const clock = new ManualClock(100), timers: { callback(): void; delay: number; cancelled: boolean }[] = [];
  let options: BrowserMidiControllerOptions;
  let connected = 1, running = false;
  let resolveStart: () => void = () => {};
  const midi = { start: vi.fn(async () => { if (delayed) await new Promise<void>(resolve => { resolveStart = resolve; }); running = true; }),
    stop: vi.fn(() => { running = false; }), dispose: vi.fn(() => { running = false; }),
    getState: () => ({ isSupported: true, hasPermission: true, connectedInputCount: connected, isRunning: running }) };
  const metronome = { start: vi.fn(), destroy: vi.fn(), setEnabled: vi.fn(), setStepContext: vi.fn() };
  const platform: StepPlatform = { clock, timer: {
    schedule: (callback, delay) => { const task = { callback, delay, cancelled: false }; timers.push(task); return task; },
    cancel: handle => { (handle as typeof timers[number]).cancelled = true; },
  }, createMidi: vi.fn(value => { options = value; return midi; }), createMetronome: vi.fn(() => metronome) };
  const scope: PracticeScope = { kind: 'RANGE', startGroupId: selectedArtifact.moments[index].groupId,
    endGroupId: selectedArtifact.moments.at(-1)!.groupId };
  const completion = vi.fn();
  const create = () => new StepPracticeController({ devices: borrowedDevices(), artifact: selectedArtifact, scope, inputSource, platform, onNaturalCompletion: completion });
  const controller = create();
  const finalized: StepAttemptRecord[] = [];
  controller.subscribe(() => {
    const record = controller.snapshot().pendingPostVerdict;
    if (record && finalized.at(-1)?.attemptId !== record.attemptId) finalized.push(record);
  });
  const note = (pianoKey: PracticePianoKey, type: 'NOTE_ON' | 'NOTE_OFF' = 'NOTE_ON', ms = clock.nowMs()) => {
    const noteNumber = pianoKey;
    const parsed = parseMidiMessage(new Uint8Array([type === 'NOTE_ON' ? 0x90 : 0x80, noteNumber, 80]))!;
    options.onMidiNote?.({ ...parsed, sessionTime: options.timebase.atSessionMs(ms) });
  };
  const close = () => { const task = timers.at(-1)!; clock.advance(35); if (!task.cancelled) task.callback(); };
  const disconnect = () => { connected = 0; options.onStateChange?.(midi.getState()); };
  const reconnect = () => { connected = 1; options.onStateChange?.(midi.getState()); };
  return { finalized, controller, create, platform, clock, timers, midi, metronome, completion, note, close, disconnect, reconnect,
    resolveStart: () => resolveStart(), options: () => options };
}
describe('STEP application owner / bounded MIDI gesture', () => {

  it('application IDLE -> PREPARING -> ACTIVE is separate from already-ACTIVE internal domain status', async () => {
    const s = setup(0, 'MIDI', true);
    expect(s.controller.snapshot()).toMatchObject({ state: 'IDLE', sessionSnapshot: null });
    const states: string[] = []; s.controller.subscribe(() => states.push(s.controller.snapshot().state));
    const pending = s.controller.start();
    expect(s.controller.snapshot()).toMatchObject({ state: 'PREPARING', canAcceptAttempt: false,
      sessionSnapshot: { runtimeStatus: 'ACTIVE', completionReason: null, step: { inputAvailable: false } } });
    expect(s.controller.snapshot().sessionSnapshot).not.toHaveProperty('lifecycleState');
    s.resolveStart(); await pending;
    expect(states).toEqual(['PREPARING', 'ACTIVE']);
    expect(s.controller.snapshot()).toMatchObject({ state: 'ACTIVE', canAcceptAttempt: true, sessionSnapshot: { runtimeStatus: 'ACTIVE' } });
    await s.controller.abandon(); await s.controller.abandon();
    expect(s.controller.snapshot()).toMatchObject({ state: 'DISPOSED', sessionSnapshot: { runtimeStatus: 'ENDED', completionReason: 'STOPPED_BY_USER' } });
    expect(s.completion).not.toHaveBeenCalled(); s.controller.dispose(); s.controller.dispose();
    expect(s.midi.dispose).toHaveBeenCalledTimes(1); expect(s.metronome.destroy).toHaveBeenCalledTimes(1);
  });
  it('preparation failure returns to application IDLE without inventing a domain IDLE snapshot', async () => {
    const s = setup(); s.midi.start.mockRejectedValueOnce(new Error('NO_CONNECTED_INPUT'));
    await s.controller.start();
    expect(s.controller.snapshot()).toMatchObject({ state: 'IDLE', sessionSnapshot: null, error: 'NO_CONNECTED_INPUT', canAcceptAttempt: false });
    expect(s.completion).not.toHaveBeenCalled(); expect(s.midi.dispose).toHaveBeenCalledTimes(1);
    expect(s.metronome.destroy).toHaveBeenCalledTimes(1); s.controller.dispose();
    expect(s.midi.dispose).toHaveBeenCalledTimes(1);
  });
  it.each([60,62])('exact end note is ignored before or after close (%s), strictly later note starts fresh', async pianoKey => {
    const run = async (order: 'BEFORE' | 'AFTER') => {
      const s = setup(); await s.controller.start(); s.clock.set(200); s.note(pianoKey);
      if (order === 'BEFORE') s.note(60,'NOTE_ON',235);
      s.close();
      if (order === 'AFTER') s.note(60,'NOTE_ON',235);
      const step = s.controller.snapshot().sessionSnapshot!.step;
      expect(s.finalized).toHaveLength(1); expect(step.activeAttempt).toBeNull(); expect(s.timers).toHaveLength(1);
      s.clock.set(236); s.note(60); const later = s.controller.snapshot().sessionSnapshot!.step.activeAttempt!;
      expect(later.attemptStartSessionTime.ms).toBe(236);
      const semantic = {index:step.currentIndex,records:s.finalized.map(r=>({verdict:r.verdict,stepId:r.stepId,
        generation:r.targetGeneration,pianoKeys:r.observedAttackKeys,start:r.attemptStartSessionTime.ms,end:r.captureEndSessionTime.ms})),
        laterGeneration:later.targetGeneration,laterStep:later.stepId};
      s.controller.dispose(); return semantic;
    };
    expect(await run('BEFORE')).toEqual(await run('AFTER'));
  });
  it.each([
    [0, [60], 'MATCH'], [0, [61], 'MISMATCH'], [0, [72], 'MISMATCH'],
    [3, [69, 72], 'MATCH'], [3, [69], 'MISMATCH'], [3, [69, 72, 74], 'MISMATCH'],
  ] as const)('target %s closes full gesture %j before %s', async (index, pianoKeys, verdict) => {
    const s = setup(index); await s.controller.start(); s.clock.set(101);
    pianoKeys.forEach(p => s.note(p));
    expect(s.finalized).toHaveLength(0);
    expect(s.controller.snapshot().sessionSnapshot?.step.attemptState).toBe('CAPTURING');
    expect(s.timers).toHaveLength(1); expect(s.timers[0].delay).toBe(STEP_MIDI_CHORD_COHERENCE_MS);
    s.close(); const snapshot = s.controller.snapshot().sessionSnapshot!;
    expect(s.finalized[0].verdict).toBe(verdict);
    expect(s.finalized[0].confidence).toBe(1);
    expect(snapshot.step.currentIndex).toBe(index + (verdict === 'MATCH' ? 1 : 0));
    expect(snapshot.step.attemptState).toBe('READY');
    s.timers[0].callback(); expect(s.finalized).toHaveLength(1);
    s.controller.dispose();
  });
  it('near-simultaneous extra pianoKey cannot follow an early correct chord acceptance', async () => {
    const s = setup(3); await s.controller.start(); s.clock.set(101); s.note(69); s.note(72, 'NOTE_ON', 110);
    expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(3);
    s.note(74, 'NOTE_ON', 134); s.close();
    expect(s.finalized[0].verdict).toBe('MISMATCH');
    s.controller.dispose();
  });
  it('fixed first-note window is not extended by later notes or delayed timers', async () => {
    const s = setup(3); await s.controller.start(); s.clock.set(101); s.note(69); s.note(72, 'NOTE_ON', 136); s.note(74, 'NOTE_ON', 500);
    expect(s.timers).toHaveLength(1); s.close();
    expect(s.finalized[0].observedAttackKeys).toEqual([69]);
    expect(s.controller.snapshot().inputDiagnostics?.ignoredNotes).toBe(2); s.controller.dispose();
  });
  it('multiple wrong attempts then correct each close separately; metronome target changes only after MATCH', async () => {
    const s = setup(); await s.controller.start(); s.clock.set(101);
    const contexts = s.metronome.setStepContext.mock.calls.length;
    for (const p of [61, 72, 60]) { s.clock.advance(1); s.note(p); s.close(); }
    expect(s.finalized.map(r => r.verdict)).toEqual(['MISMATCH', 'MISMATCH', 'MATCH']);
    expect(s.metronome.setStepContext.mock.calls.length).toBe(contexts + 1); s.controller.dispose();
  });
  it('partial then later full chord does not reuse the previous gesture', async () => {
    const s = setup(3); await s.controller.start(); s.clock.set(101); s.note(69); s.close(); s.clock.advance(1); s.note(72); s.close();
    expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(3);
    s.clock.advance(1); s.note(69); s.note(72); s.close(); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(4);
    s.controller.dispose();
  });
  it('held note cannot advance next repeated target, fresh NOTE_ON can', async () => {
    const s = setup(); await s.controller.start(); s.clock.set(101); s.note(60); s.close();
    s.note(60, 'NOTE_OFF'); expect(s.timers).toHaveLength(1);
    expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(1);
    s.clock.advance(1); s.note(60); s.close(); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(2); s.controller.dispose();
  });
  it.each(['abandon', 'disconnect', 'dispose'] as const)('%s cancels capturing, including stale timer callback', async command => {
    const s = setup(); await s.controller.start(); s.clock.set(101); s.note(60); const callback = s.timers[0].callback;
    if (command === 'disconnect') s.disconnect(); else s.controller[command]();
    const after = s.controller.snapshot(); callback();
    expect(s.controller.snapshot().sessionSnapshot?.step).toEqual(after.sessionSnapshot?.step);
    expect(s.finalized).toHaveLength(0);
    if (command === 'disconnect') expect(after).toMatchObject({ state: 'ACTIVE', error: 'NO_CONNECTED_INPUT' });
    s.controller.dispose();
  });
  it('reconnect waits on the same target, rejects stale/equal input and cancelled callback', async () => {
    const s = setup(); await s.controller.start(); s.clock.set(101); s.note(60); const first = s.controller.snapshot().sessionSnapshot!.step.activeAttempt!;
    s.disconnect(); s.clock.set(200); s.note(60);
    expect(s.controller.snapshot().sessionSnapshot!.step.activeAttempt).toBeNull();
    s.reconnect(); s.note(60, 'NOTE_ON', 101); s.note(60);
    expect(s.controller.snapshot().sessionSnapshot!.step.activeAttempt).toBeNull();
    s.clock.advance(1); s.note(60);
    const next = s.controller.snapshot().sessionSnapshot!.step.activeAttempt!;
    expect(next.targetGeneration).toBe(first.targetGeneration);
    expect(next.stepId).toBe(first.stepId); expect(next.attemptId).not.toBe(first.attemptId);
    expect(s.midi.stop).not.toHaveBeenCalled(); expect(s.midi.start).toHaveBeenCalledTimes(1);
    s.timers[0].callback(); expect(s.finalized).toHaveLength(0);
    s.close(); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(1); s.controller.dispose();
  });
  it('ANALYZING/POST_VERDICT input is ignored, never queued for the next target', async () => {
    const s = setup(); await s.controller.start(); s.clock.set(101);
    const states: string[] = [];
    s.controller.subscribe(() => {
      const state = s.controller.snapshot().sessionSnapshot?.step.attemptState;
      if (state === 'ANALYZING' || state === 'POST_VERDICT') { states.push(state); s.note(60); }
    });
    s.note(60); s.close();
    expect(states).toEqual(['ANALYZING', 'POST_VERDICT']);
    expect(s.timers).toHaveLength(1); expect(s.controller.snapshot().sessionSnapshot?.step.currentIndex).toBe(1);
    expect(s.controller.snapshot().inputDiagnostics?.ignoredNotes).toBe(2); s.controller.dispose();
  });
  it('readiness retires input buffered during asynchronous preparation', async () => {
    const s = setup(0, 'MIDI', true), pending = s.controller.start();
    s.clock.set(500); s.resolveStart(); await pending;
    for (const ms of [100, 499, 500]) s.note(60, 'NOTE_ON', ms);
    expect(s.timers).toHaveLength(0);
    expect(s.controller.snapshot().sessionSnapshot!.step.inputEligibleAfter.ms).toBe(500);
    s.note(60, 'NOTE_ON', 501); expect(s.timers).toHaveLength(1); s.controller.dispose();
  });
  it('POST_VERDICT keeps answered target/metronome; READY commits current-time retirement with zero delay', async () => {
    const s = setup(); await s.controller.start(); s.clock.set(200);
    const contexts = s.metronome.setStepContext.mock.calls.length;
    const trace: { phase: string | null; index: number; ready: boolean }[] = [];
    const unsubscribe = s.controller.subscribe(() => {
      const snapshot = s.controller.snapshot();
      trace.push({ phase: snapshot.stepInteractionPhase, index: snapshot.sessionSnapshot!.step.currentIndex, ready: snapshot.canAcceptAttempt });
      if (snapshot.stepInteractionPhase === 'POST_VERDICT') {
        expect(snapshot.pendingPostVerdict?.verdict).toBe('MATCH');
        expect(snapshot.activeStepGroup?.groupId).toBe(artifact.moments[0].groupId);
        expect(s.metronome.setStepContext.mock.calls).toHaveLength(contexts);
        s.controller.skip();
        s.clock.set(900); // Represents time spent on finalized feedback, not a policy cooldown.
      }
    });
    s.note(60); s.close();
    expect(trace).toEqual([
      { phase: 'CAPTURING', index: 0, ready: false }, { phase: 'ANALYZING', index: 0, ready: false },
      { phase: 'POST_VERDICT', index: 0, ready: false }, { phase: 'READY', index: 1, ready: true },
    ]);
    expect(s.controller.snapshot().sessionSnapshot!.step.inputEligibleAfter.ms).toBe(900);
    unsubscribe();
    expect(s.timers).toHaveLength(1); // Only the 35ms gesture timer, no post-verdict timer.
    s.note(60, 'NOTE_ON', 800); s.note(60, 'NOTE_ON', 900);
    expect(s.timers).toHaveLength(1);
    s.clock.set(901); s.note(60); s.close();
    expect(s.finalized).toHaveLength(2); s.controller.dispose();
  });
  it.each(['ANALYZING', 'POST_VERDICT'] as const)('disconnect in synchronous %s notification does not revive or double-advance', async phase => {
    const s = setup(); await s.controller.start(); s.clock.set(200);
    let disconnected = false;
    s.controller.subscribe(() => {
      if (!disconnected && s.controller.snapshot().stepInteractionPhase === phase) { disconnected = true; s.disconnect(); }
    });
    s.note(60); s.close();
    expect(s.controller.snapshot().canAcceptAttempt).toBe(false);
    expect(s.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(0);
    expect(s.finalized).toHaveLength(phase === 'POST_VERDICT' ? 1 : 0);
    s.clock.set(500); s.reconnect(); s.reconnect();
    expect(s.controller.snapshot().canAcceptAttempt).toBe(true);
    expect(s.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(phase === 'POST_VERDICT' ? 1 : 0);
    s.note(60, 'NOTE_ON', 499); s.note(60, 'NOTE_ON', 500); s.timers[0].callback();
    expect(s.controller.snapshot().sessionSnapshot!.step.activeAttempt).toBeNull();
    s.clock.set(501); s.note(60); s.close();
    expect(s.controller.snapshot().sessionSnapshot!.step.currentIndex).toBe(phase === 'POST_VERDICT' ? 2 : 1);
    s.controller.dispose();
  });
  it('skip during CAPTURING does not cancel the bounded gesture; final feedback precedes completion', async () => {
    const s = setup(4); await s.controller.start(); s.clock.set(200); s.note(74);
    s.controller.skip(); expect(s.controller.snapshot().stepInteractionPhase).toBe('CAPTURING');
    s.controller.subscribe(() => {
      if (s.controller.snapshot().stepInteractionPhase === 'POST_VERDICT') {
        expect(s.completion).not.toHaveBeenCalled();
        expect(s.controller.snapshot().activeStepGroup?.groupId).toBe(artifact.moments[4].groupId);
      }
    });
    s.close(); await s.controller.abandon(); expect(s.completion).toHaveBeenCalledTimes(1);
    expect(s.completion).toHaveBeenCalledTimes(1); s.controller.dispose();
  });
  it('disconnect while waiting keeps target/session and automatically returns to waiting', async () => {
    const s = setup(); await s.controller.start(); const original = s.controller.snapshot().sessionSnapshot!;
    s.disconnect(); s.note(60, 'NOTE_ON', 150);
    expect(s.timers).toHaveLength(0); expect(s.controller.snapshot().state).toBe('ACTIVE');
    s.clock.set(300); s.reconnect(); s.note(60, 'NOTE_ON', 299); s.note(60, 'NOTE_ON', 300);
    expect(s.timers).toHaveLength(0);
    const current = s.controller.snapshot().sessionSnapshot!;
    expect(current.localSessionId).toBe(original.localSessionId);
    expect(current.step.targetGeneration).toBe(original.step.targetGeneration);
    expect(s.finalized).toHaveLength(0);
    expect(s.controller.snapshot().error).toBeNull();
    s.note(60, 'NOTE_ON', 301); expect(s.timers).toHaveLength(1); s.controller.dispose();
  });
  it('natural completion and disposal release resources exactly once, before completion notification', async () => {
    const s = setup(4); await s.controller.start(); s.clock.set(101); s.note(74); s.close(); await s.controller.abandon();
    expect(s.controller.snapshot().state).toBe('ENDED'); expect(s.completion).toHaveBeenCalledTimes(1);
    expect(s.midi.dispose).toHaveBeenCalledTimes(1); expect(s.metronome.destroy).toHaveBeenCalledTimes(1);
    s.controller.abandon(); s.controller.dispose(); s.controller.dispose();
    expect(s.midi.dispose).toHaveBeenCalledTimes(1); expect(s.metronome.destroy).toHaveBeenCalledTimes(1);
  });
  it('dispose during preparation cancels late start and emits no successful session', async () => {
    const s = setup(0, 'MIDI', true), pending = s.controller.start(); s.controller.dispose(); s.resolveStart(); await pending;
    expect(s.controller.snapshot().state).toBe('DISPOSED'); expect(s.completion).not.toHaveBeenCalled();
    expect(s.midi.dispose).toHaveBeenCalledTimes(1);
  });
  it('fresh owner uses a fresh session and no old timer can advance it', async () => {
    const s = setup(); await s.controller.start(); s.clock.set(101); s.note(60); const old = s.controller.snapshot().sessionSnapshot!;
    s.controller.dispose(); const fresh = s.create(); await fresh.start(); s.timers[0].callback();
    expect(fresh.snapshot().sessionSnapshot?.localSessionId).not.toBe(old.localSessionId);
    expect(fresh.snapshot().sessionSnapshot?.step.currentIndex).toBe(0); fresh.dispose();
  });
  it('missing microphone platform fails truthfully without constructing MIDI or metronome', async () => {
    const s = setup(0, 'MICROPHONE'); await s.controller.start();
    expect(s.controller.snapshot()).toMatchObject({ state: 'IDLE', error: 'STEP_MICROPHONE_UNAVAILABLE', sessionSnapshot: null });
    expect(s.midi.start).not.toHaveBeenCalled(); expect(s.metronome.start).not.toHaveBeenCalled(); s.controller.dispose();
  });
});

it.each(['READY', 'CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const)('STEP End in %s retires the owner without natural completion or stale revival', async phase => {
  const s = setup(); await s.controller.start();
  const oldSession = s.controller.snapshot().sessionSnapshot!.localSessionId;
  const staleInput = s.options().onMidiNote!;
  const staleTimebase = s.options().timebase;
  let ending: Promise<void> | undefined;
  if (phase === 'ANALYZING' || phase === 'POST_VERDICT') s.controller.subscribe(() => {
    if (!ending && s.controller.snapshot().state === 'ACTIVE' && s.controller.snapshot().stepInteractionPhase === phase) ending = s.controller.abandon();
  });
  if (phase !== 'READY') { s.clock.set(200); s.note(60); }
  if (phase === 'ANALYZING' || phase === 'POST_VERDICT') s.close();
  await (ending ?? s.controller.abandon());
  const retired = s.controller.snapshot();
  for (const task of s.timers) task.callback();
  staleInput({ type: 'NOTE_ON', noteNumber: 60, velocity: 80, sessionTime: staleTimebase.atSessionMs(1000) });
  expect(s.controller.snapshot()).toMatchObject({ state: 'DISPOSED', canAcceptAttempt: false,
    sessionSnapshot: { localSessionId: oldSession, step: retired.sessionSnapshot!.step, completionReason: 'STOPPED_BY_USER' } }); expect(s.completion).not.toHaveBeenCalled();
  const fresh = s.create(); await fresh.start();
  expect(fresh.snapshot().sessionSnapshot!.localSessionId).not.toBe(oldSession);
  expect(fresh.snapshot()).toMatchObject({ state: 'ACTIVE', pendingPostVerdict: null, stepInteractionPhase: 'READY' });
  await fresh.abandon();
});
