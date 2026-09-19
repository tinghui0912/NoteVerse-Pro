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
  });

  it('reports both READY when all browser APIs, OPFS, and model access are present', () => {
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(true);
    expect(caps.microphone.status).toBe('READY');
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('READY');
    expect(getSelectedInputCapability('MICROPHONE', caps).status).toBe('READY');
    expect(getSelectedInputCapability('MIDI', caps).status).toBe('READY');
  });

  it('reports MODEL_ACCESS_UNAVAILABLE when model access is unavailable, but MIDI remains READY', () => {
    const caps = evaluatePracticeInputCapabilities({ modelAccessAvailable: false });
    expect(caps.microphone.supported).toBe(false);
    expect(caps.microphone.status).toBe('MODEL_ACCESS_UNAVAILABLE');
    expect(caps.microphone.reason).toBe('MODEL_ACCESS_UNAVAILABLE');

    // Crucial: MIDI MUST NOT be affected by missing microphone model access!
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('READY');
    expect(isInputSourceSupported('MIDI', caps)).toBe(true);
    expect(isInputSourceSupported('MICROPHONE', caps)).toBe(false);
  });

  it('reports MODEL_STORAGE_UNAVAILABLE when OPFS is missing, but MIDI remains READY', () => {
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

  it('reports BROWSER_UNSUPPORTED when AudioWorklet is missing, but MIDI remains READY', () => {
    delete (window as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(false);
    expect(caps.microphone.status).toBe('BROWSER_UNSUPPORTED');
    expect(caps.microphone.reason).toBe('BROWSER_UNSUPPORTED');

    // MIDI is independent of AudioWorklet
    expect(caps.midi.supported).toBe(true);
    expect(isInputSourceSupported('MIDI', caps)).toBe(true);
  });

  it('reports BROWSER_UNSUPPORTED for MIDI when requestMIDIAccess is missing, but microphone remains READY', () => {
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
