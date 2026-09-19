// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  evaluatePracticeInputCapabilities,
  getSelectedInputCapability,
  isInputSourceSupported,
} from './input-capability';

describe('evaluatePracticeInputCapabilities', () => {
  const originalEnv = process.env.NEXT_PUBLIC_BYTEDANCE_MODEL_URL;
  const originalAudioContext = window.AudioContext;
  const originalAudioWorkletNode = window.AudioWorkletNode;
  const originalMediaDevices = navigator.mediaDevices;
  const originalRequestMIDIAccess = (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BYTEDANCE_MODEL_URL = 'https://assets.noteverse.net/models/test.onnx';
    window.AudioContext = class MockAudioContext {} as unknown as typeof AudioContext;
    window.AudioWorkletNode = class MockAudioWorkletNode {} as unknown as typeof AudioWorkletNode;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: async () => ({}) },
      configurable: true,
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => ({}),
      configurable: true,
    });
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_BYTEDANCE_MODEL_URL = originalEnv;
    window.AudioContext = originalAudioContext;
    window.AudioWorkletNode = originalAudioWorkletNode;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: originalRequestMIDIAccess,
      configurable: true,
    });
  });

  it('reports both READY when all browser APIs and model URL are present', () => {
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(true);
    expect(caps.microphone.status).toBe('READY');
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('READY');
    expect(getSelectedInputCapability('MICROPHONE', caps).status).toBe('READY');
    expect(getSelectedInputCapability('MIDI', caps).status).toBe('READY');
  });

  it('reports MODEL_URL_NOT_CONFIGURED when model URL is missing, but MIDI remains READY', () => {
    delete process.env.NEXT_PUBLIC_BYTEDANCE_MODEL_URL;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphone.supported).toBe(false);
    expect(caps.microphone.status).toBe('MODEL_URL_NOT_CONFIGURED');
    expect(caps.microphone.reason).toBe('MODEL_URL_NOT_CONFIGURED');

    // Crucial: MIDI MUST NOT be affected by missing microphone model URL!
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('READY');
    expect(isInputSourceSupported('MIDI', caps)).toBe(true);
    expect(isInputSourceSupported('MICROPHONE', caps)).toBe(false);
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
