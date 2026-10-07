// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluatePracticeInputCapabilities,
  getSelectedInputCapability,
  isInputSourceSupported,
} from './input-capability';

describe('evaluatePracticeInputCapabilities', () => {
  const originalAudioContext = window.AudioContext;
  const originalAudioWorkletNode = window.AudioWorkletNode;
  const originalMediaDevices = navigator.mediaDevices;
  const originalStorage = navigator.storage;
  const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  const originalRequestMIDIAccess = (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;

  beforeEach(() => {
    window.AudioContext = class MockAudioContext {} as unknown as typeof AudioContext;
    window.AudioWorkletNode = class MockAudioWorkletNode {} as unknown as typeof AudioWorkletNode;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({}) },
      configurable: true,
    });
    Object.defineProperty(navigator, 'storage', {
      value: { getDirectory: async () => ({}) },
      configurable: true,
    });
    Object.defineProperty(navigator, 'gpu', {
      value: {},
      configurable: true,
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => ({}),
      configurable: true,
    });
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    window.AudioWorkletNode = originalAudioWorkletNode;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
    Object.defineProperty(navigator, 'storage', {
      value: originalStorage,
      configurable: true,
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: originalRequestMIDIAccess,
      configurable: true,
    });
    Object.defineProperty(navigator, 'gpu', {
      value: originalGpu,
      configurable: true,
    });
  });

  it('reports browser microphone capture separately from acoustic analysis availability', () => {
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(true);
    expect(caps.microphoneCapture.status).toBe('AVAILABLE');
    expect(caps.acousticAnalysis.step.status).toBe('ATTEMPT_ANALYZER_NOT_VALIDATED');
    expect(caps.acousticAnalysis.continuous.status).toBe('MODEL_NOT_VALIDATED');
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('AVAILABLE');
    expect(getSelectedInputCapability('MIDI', caps, 'STEP_BY_STEP').status).toBe('AVAILABLE');
  });

  it('disables STEP microphone until bounded-attempt analysis is available', () => {
    const caps = evaluatePracticeInputCapabilities();

    expect(getSelectedInputCapability('MICROPHONE', caps, 'STEP_BY_STEP')).toMatchObject({
      supported: false,
      status: 'STEP_ANALYSIS_UNAVAILABLE',
      reason: 'STEP_ANALYSIS_UNAVAILABLE',
    });
    expect(isInputSourceSupported('MICROPHONE', caps, 'STEP_BY_STEP')).toBe(false);
  });

  it('disables Continuous microphone until mode-specific acoustic analysis is available', () => {
    const caps = evaluatePracticeInputCapabilities();

    expect(getSelectedInputCapability('MICROPHONE', caps, 'CONTINUOUS_PLAY')).toMatchObject({
      supported: false,
      status: 'CONTINUOUS_ANALYSIS_UNAVAILABLE',
      reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE',
    });
    expect(isInputSourceSupported('MICROPHONE', caps, 'CONTINUOUS_PLAY')).toBe(false);
    expect(isInputSourceSupported('MIDI', caps, 'CONTINUOUS_PLAY')).toBe(true);
  });

  it('does not make model access a browser microphone capture prerequisite', () => {
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(true);
    expect(caps.microphoneCapture.status).toBe('AVAILABLE');

    // MIDI remains independent of microphone model access.
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('AVAILABLE');
    expect(isInputSourceSupported('MIDI', caps, 'STEP_BY_STEP')).toBe(true);
    expect(isInputSourceSupported('MICROPHONE', caps, 'STEP_BY_STEP')).toBe(false);
    expect(isInputSourceSupported('MICROPHONE', caps, 'CONTINUOUS_PLAY')).toBe(false);
  });

  it('does not make OPFS a browser microphone capture prerequisite', () => {
    Object.defineProperty(navigator, 'storage', {
      value: undefined,
      configurable: true,
    });
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(true);
    expect(caps.microphoneCapture.status).toBe('AVAILABLE');

    // MIDI is independent of OPFS
    expect(caps.midi.supported).toBe(true);
    expect(isInputSourceSupported('MIDI', caps, 'STEP_BY_STEP')).toBe(true);
  });

  it('reports BROWSER_UNSUPPORTED when AudioWorklet is missing, but MIDI remains AVAILABLE', () => {
    delete (window as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(false);
    expect(caps.microphoneCapture.status).toBe('BROWSER_UNSUPPORTED');
    expect(getSelectedInputCapability('MICROPHONE', caps, 'STEP_BY_STEP')).toMatchObject({
      supported: false,
      status: 'BROWSER_UNSUPPORTED',
      reason: 'BROWSER_UNSUPPORTED',
    });

    // MIDI is independent of AudioWorklet
    expect(caps.midi.supported).toBe(true);
    expect(isInputSourceSupported('MIDI', caps, 'STEP_BY_STEP')).toBe(true);
  });

  it('reports BROWSER_UNSUPPORTED for MIDI when requestMIDIAccess is missing, but microphone remains AVAILABLE', () => {
    delete (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(true);
    expect(caps.midi.supported).toBe(false);
    expect(caps.midi.status).toBe('BROWSER_UNSUPPORTED');
    expect(caps.midi.reason).toBe('BROWSER_UNSUPPORTED');
    expect(isInputSourceSupported('MICROPHONE', caps, 'STEP_BY_STEP')).toBe(false);
    expect(isInputSourceSupported('MIDI', caps, 'STEP_BY_STEP')).toBe(false);
  });

  it('reports NO_CONNECTED_INPUT for MIDI when connectedMidiInputs is 0', () => {
    const caps = evaluatePracticeInputCapabilities({ connectedMidiInputs: 0 });
    expect(caps.midi.supported).toBe(false);
    expect(caps.midi.status).toBe('NO_CONNECTED_INPUT');
    expect(caps.midi.reason).toBe('NO_CONNECTED_INPUT');
  });

  it('requires PracticeMode for product-level microphone availability', () => {
    const caps = evaluatePracticeInputCapabilities();
    const unsafeCall = getSelectedInputCapability as unknown as (
      source: 'MICROPHONE',
      inputCapabilities: typeof caps
    ) => unknown;

    expect(() => unsafeCall('MICROPHONE', caps)).toThrow(/PracticeMode is required/);
  });
});
