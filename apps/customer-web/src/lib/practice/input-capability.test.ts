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

  it('reports both AVAILABLE when all browser APIs, OPFS, and model access are present', () => {
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(true);
    expect(caps.microphone.status).toBe('AVAILABLE');
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('AVAILABLE');
    expect(getSelectedInputCapability('MICROPHONE', caps).status).toBe('AVAILABLE');
    expect(getSelectedInputCapability('MIDI', caps).status).toBe('AVAILABLE');
  });

  it('keeps STEP microphone available but disables Continuous microphone until transcription is supported', () => {
    const caps = evaluatePracticeInputCapabilities();

    expect(getSelectedInputCapability('MICROPHONE', caps, 'STEP_BY_STEP')).toMatchObject({
      supported: true,
      status: 'AVAILABLE',
    });
    expect(getSelectedInputCapability('MICROPHONE', caps, 'CONTINUOUS_PLAY')).toMatchObject({
      supported: false,
      status: 'CONTINUOUS_ANALYSIS_UNAVAILABLE',
      reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE',
    });
    expect(isInputSourceSupported('MICROPHONE', caps, 'CONTINUOUS_PLAY')).toBe(false);
    expect(isInputSourceSupported('MIDI', caps, 'CONTINUOUS_PLAY')).toBe(true);
  });

  it('reports MODEL_ACCESS_UNAVAILABLE when model access is unavailable, but MIDI remains AVAILABLE', () => {
    const caps = evaluatePracticeInputCapabilities({ modelAccessAvailable: false });
    expect(caps.microphone.supported).toBe(false);
    expect(caps.microphone.status).toBe('MODEL_ACCESS_UNAVAILABLE');
    expect(caps.microphone.reason).toBe('MODEL_ACCESS_UNAVAILABLE');

    // Crucial: MIDI MUST NOT be affected by missing microphone model access!
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('AVAILABLE');
    expect(isInputSourceSupported('MIDI', caps)).toBe(true);
    expect(isInputSourceSupported('MICROPHONE', caps)).toBe(false);
  });

  it('reports MODEL_STORAGE_UNAVAILABLE when OPFS is missing, but MIDI remains AVAILABLE', () => {
    Object.defineProperty(navigator, 'storage', {
      value: undefined,
      configurable: true,
    });
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(false);
    expect(caps.microphone.status).toBe('MODEL_STORAGE_UNAVAILABLE');
    expect(caps.microphone.reason).toBe('MODEL_STORAGE_UNAVAILABLE');

    // MIDI is independent of OPFS
    expect(caps.midi.supported).toBe(true);
    expect(isInputSourceSupported('MIDI', caps)).toBe(true);
  });

  it('reports BROWSER_UNSUPPORTED when AudioWorklet is missing, but MIDI remains AVAILABLE', () => {
    delete (window as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(false);
    expect(caps.microphone.status).toBe('BROWSER_UNSUPPORTED');
    expect(caps.microphone.reason).toBe('BROWSER_UNSUPPORTED');

    // MIDI is independent of AudioWorklet
    expect(caps.midi.supported).toBe(true);
    expect(isInputSourceSupported('MIDI', caps)).toBe(true);
  });

  it('reports BROWSER_UNSUPPORTED for MIDI when requestMIDIAccess is missing, but microphone remains AVAILABLE', () => {
    delete (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(true);
    expect(caps.midi.supported).toBe(false);
    expect(caps.midi.status).toBe('BROWSER_UNSUPPORTED');
    expect(caps.midi.reason).toBe('BROWSER_UNSUPPORTED');
    expect(isInputSourceSupported('MICROPHONE', caps)).toBe(true);
    expect(isInputSourceSupported('MIDI', caps)).toBe(false);
  });

  it('reports NO_CONNECTED_INPUT for MIDI when connectedMidiInputs is 0', () => {
    const caps = evaluatePracticeInputCapabilities({ connectedMidiInputs: 0 });
    expect(caps.midi.supported).toBe(false);
    expect(caps.midi.status).toBe('NO_CONNECTED_INPUT');
    expect(caps.midi.reason).toBe('NO_CONNECTED_INPUT');
  });
});
