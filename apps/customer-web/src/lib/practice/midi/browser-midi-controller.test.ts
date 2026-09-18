import { describe, expect, it, vi } from 'vitest';
import { PracticeTimebase } from '../local-core/timebase';
import {
  BrowserMidiController,
  midiNoteToPitch,
  parseMidiMessage,
} from './browser-midi-controller';

describe('browser MIDI controller', () => {
  it('converts MIDI note numbers to scientific pitch notation', () => {
    expect(midiNoteToPitch(60)).toBe('C4');
    expect(midiNoteToPitch(69)).toBe('A4');
    expect(midiNoteToPitch(21)).toBe('A0');
    expect(midiNoteToPitch(108)).toBe('C8');
  });

  it('parses note_on and note_off messages correctly', () => {
    // Note on: channel 0, pitch 60, velocity 100
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 100]))).toEqual({
      type: 'NOTE_ON',
      noteNumber: 60,
      pitch: 'C4',
      velocity: 100,
    });

    // Note on with velocity 0 is treated as note_off
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 0]))).toEqual({
      type: 'NOTE_OFF',
      noteNumber: 60,
      pitch: 'C4',
      velocity: 0,
    });

    // Explicit note off: channel 0, pitch 60, velocity 64
    expect(parseMidiMessage(new Uint8Array([0x80, 60, 64]))).toEqual({
      type: 'NOTE_OFF',
      noteNumber: 60,
      pitch: 'C4',
      velocity: 0,
    });
  });

  it('coalesces chord attacks and emits StepVerifierObservation', async () => {
    vi.useFakeTimers();
    const timebase = new PracticeTimebase({ domainId: 'midi-session' });
    const stepObservations: unknown[] = [];
    const performanceObservations: unknown[] = [];

    const controller = new BrowserMidiController({
      timebase,
      chordCoalesceWindowMs: 30,
      getCurrentStepTarget: () => ({
        stepId: 'step-chord',
        activationGeneration: 1,
        activationBoundary: { domainId: 'midi-session', ms: 0 },
        attackPitches: ['C4', 'E4', 'G4'],
        continuationPitches: [],
      }),
      onStepObservation: (obs) => stepObservations.push(obs),
      onPerformanceObservation: (obs) => performanceObservations.push(obs),
    });

    // Mark as running by simulating dispatch
    (controller as unknown as { isRunning: boolean }).isRunning = true;

    // Dispatch C4, then E4, then G4 within 20ms
    controller.dispatchMidiData(new Uint8Array([0x90, 60, 80]), 100);
    controller.dispatchMidiData(new Uint8Array([0x90, 64, 85]), 110);
    // Since target was ['C4', 'E4', 'G4'], delivering the third should flush immediately
    controller.dispatchMidiData(new Uint8Array([0x90, 67, 90]), 115);

    expect(stepObservations).toHaveLength(1);
    expect(stepObservations[0]).toMatchObject({
      stepId: 'step-chord',
      activationGeneration: 1,
      attackOnsetTime: { domainId: 'midi-session', ms: 100 },
      observedAttackPitches: expect.arrayContaining(['C4', 'E4', 'G4']),
      source: 'MIDI',
    });

    expect(performanceObservations).toHaveLength(3);
    expect(performanceObservations[0]).toMatchObject({
      captureTime: { domainId: 'midi-session', ms: 100 },
      pitches: ['C4'],
      source: 'MIDI',
    });

    vi.useRealTimers();
  });
});
