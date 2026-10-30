// @vitest-environment jsdom

import { planPracticeResources } from './planning/resource-plan';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluatePracticeInputCapabilities,
  getSelectedInputCapability,
} from './input-capability';

describe('evaluatePracticeInputCapabilities', () => {
  const originalAudioContext = window.AudioContext;
  const originalAudioWorkletNode = window.AudioWorkletNode;
  const originalWebkitAudioContext = Object.getOwnPropertyDescriptor(window, 'webkitAudioContext');
  const originalMediaDevices = navigator.mediaDevices;
  const originalStorage = navigator.storage;
  const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  const originalRequestMIDIAccess = (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;

  beforeEach(() => {
    vi.stubGlobal('Worker', class MockWorker {});
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn() } });
    window.AudioContext = class MockAudioContext {} as unknown as typeof AudioContext;
    window.AudioWorkletNode = class MockAudioWorkletNode {} as unknown as typeof AudioWorkletNode;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn(async () => ({})) },
      configurable: true,
    });
    Object.defineProperty(navigator, 'storage', {
      value: { getDirectory: vi.fn(async () => ({})) },
      configurable: true,
    });
    Object.defineProperty(navigator, 'gpu', {
      value: { requestAdapter: vi.fn(async () => ({})) },
      configurable: true,
    });
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      value: async () => ({}),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.AudioContext = originalAudioContext;
    window.AudioWorkletNode = originalAudioWorkletNode;
    if (originalWebkitAudioContext) Object.defineProperty(window, 'webkitAudioContext', originalWebkitAudioContext);
    else Reflect.deleteProperty(window, 'webkitAudioContext');
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
    expect(caps.acousticAnalysis.status).toBe('AVAILABLE');
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('AVAILABLE');
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }), caps).status).toBe('AVAILABLE');
  });

  it('enables STEP microphone through the integrated controller on a full acoustic runtime', () => {
    const caps = evaluatePracticeInputCapabilities();

    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps)).toMatchObject({
      supported: true,
      status: 'AVAILABLE',
    });
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).supported).toBe(true);
  });

  it('enables Continuous microphone with the full acoustic runtime while leaving MIDI independent', () => {
    const caps = evaluatePracticeInputCapabilities();

    expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps)).toMatchObject({
      supported: true,
      status: 'AVAILABLE',
    });
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).supported).toBe(true);
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'OFF' }), caps).supported).toBe(true);
  });

  it('does not make model access a browser microphone capture prerequisite', () => {
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(true);
    expect(caps.microphoneCapture.status).toBe('AVAILABLE');

    // MIDI remains independent of microphone model access.
    expect(caps.midi.supported).toBe(true);
    expect(caps.midi.status).toBe('AVAILABLE');
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }), caps).supported).toBe(true);
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).supported).toBe(true);
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).supported).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(navigator.storage.getDirectory).not.toHaveBeenCalled();
    expect(crypto.subtle.digest).not.toHaveBeenCalled();
    expect(navigator.gpu.requestAdapter).not.toHaveBeenCalled();
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
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }), caps).supported).toBe(true);
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).status).toBe('BROWSER_UNSUPPORTED');
  });

  it('reports BROWSER_UNSUPPORTED when AudioWorklet is missing, but MIDI remains AVAILABLE', () => {
    delete (window as unknown as { AudioWorkletNode?: unknown }).AudioWorkletNode;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(false);
    expect(caps.microphoneCapture.status).toBe('BROWSER_UNSUPPORTED');
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps)).toMatchObject({
      supported: false,
      status: 'BROWSER_UNSUPPORTED',
      reason: 'BROWSER_UNSUPPORTED',
    });

    // MIDI is independent of AudioWorklet
    expect(caps.midi.supported).toBe(true);
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }), caps).supported).toBe(true);
  });

  it('reports BROWSER_UNSUPPORTED for MIDI when requestMIDIAccess is missing, but microphone remains AVAILABLE', () => {
    delete (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.supported).toBe(true);
    expect(caps.midi.supported).toBe(false);
    expect(caps.midi.status).toBe('BROWSER_UNSUPPORTED');
    expect(caps.midi.reason).toBe('BROWSER_UNSUPPORTED');
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).supported).toBe(true);
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MIDI', recordingMode: 'OFF' }), caps).supported).toBe(false);
  });

  it('reports NO_CONNECTED_INPUT for MIDI when connectedMidiInputs is 0', () => {
    const caps = evaluatePracticeInputCapabilities({ connectedMidiInputs: 0 });
    expect(caps.midi.supported).toBe(false);
    expect(caps.midi.status).toBe('NO_CONNECTED_INPUT');
    expect(caps.midi.reason).toBe('NO_CONNECTED_INPUT');
  });

  const missingRuntimeCases = [
    ['AudioWorkletNode', () => { window.AudioWorkletNode = undefined as unknown as typeof AudioWorkletNode; }, false],
    ['getUserMedia', () => { Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {} }); }, false],
    ['AudioContext', () => { window.AudioContext = undefined as unknown as typeof AudioContext; }, false],
    ['Worker', () => { vi.stubGlobal('Worker', undefined); }, true],
    ['WebGPU', () => { Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined }); }, true],
    ['WebGPU requestAdapter', () => { Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} }); }, true],
    ['OPFS', () => { Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined }); }, true],
    ['OPFS getDirectory', () => { Object.defineProperty(navigator, 'storage', { configurable: true, value: {} }); }, true],
    ['Web Crypto', () => { vi.stubGlobal('crypto', undefined); }, true],
    ['Web Crypto SHA-256 digest', () => { vi.stubGlobal('crypto', { subtle: {} }); }, true],
  ] as const;
  for (const [name, remove, pcmSupported] of missingRuntimeCases) {
    it(`fails both acoustic modes closed without ${name}, without disabling MIDI or redefining PCM capture`, () => {
      remove();
      const caps = evaluatePracticeInputCapabilities();
      expect(caps.microphoneCapture.supported).toBe(pcmSupported);
      expect(caps.acousticAnalysis.status).toBe('BROWSER_UNSUPPORTED');
      expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps)).toEqual({
        supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED',
      });
      expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).supported).toBe(false);
      expect(getSelectedInputCapability(planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).status).toBe('BROWSER_UNSUPPORTED');
      expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode: 'OFF' }), caps).supported).toBe(true);
    });
  }

  it('does not advertise Continuous for a prefixed-only AudioContext that its platform does not use', () => {
    Object.defineProperty(window, 'webkitAudioContext', { configurable: true, value: window.AudioContext });
    window.AudioContext = undefined as unknown as typeof AudioContext;
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.microphoneCapture.status).toBe('AVAILABLE');
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).status).toBe('BROWSER_UNSUPPORTED');
  });

  it('fails closed during server rendering without browser primitives', () => {
    vi.stubGlobal('window', undefined);
    const caps = evaluatePracticeInputCapabilities();
    expect(caps.acousticAnalysis.status).toBe('BROWSER_UNSUPPORTED');
    expect(getSelectedInputCapability(planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF' }), caps).supported).toBe(false);
  });

  it('uses the planned analysis projection while recording-only microphone stays separate', () => {
    vi.stubGlobal('Worker', undefined);
    const caps = evaluatePracticeInputCapabilities();
    const microphone = planPracticeResources({ mode: 'STEP_BY_STEP', inputSource: 'MICROPHONE', recordingMode: 'OFF' });
    expect(caps.microphoneCapture.supported).toBe(true);
    expect(getSelectedInputCapability(microphone, caps).supported).toBe(false);
    expect(getSelectedInputCapability({ input: microphone.input, analysis: { kind: 'NONE' } }, caps).supported).toBe(true);
    for (const recordingMode of ['AUDIO', 'VIDEO'] as const) {
      const resources = planPracticeResources({ mode: 'CONTINUOUS_PLAY', inputSource: 'MIDI', recordingMode });
      expect(getSelectedInputCapability(resources, caps)).toBe(caps.midi);
    }
  });
});
