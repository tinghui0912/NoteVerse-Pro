import type { PracticeInputSource } from './local-core/artifact';
import { productionByteDanceModelUrl } from './acoustic-inference/bytedance-contract';

export type PracticeMicrophoneStatus =
  | 'READY'
  | 'BROWSER_UNSUPPORTED'
  | 'MODEL_URL_NOT_CONFIGURED';

export type PracticeMidiStatus =
  | 'READY'
  | 'BROWSER_UNSUPPORTED'
  | 'NO_CONNECTED_INPUT';

export type MicrophoneUnavailableReason =
  | 'BROWSER_UNSUPPORTED'
  | 'MODEL_URL_NOT_CONFIGURED';

export type MidiUnavailableReason =
  | 'BROWSER_UNSUPPORTED'
  | 'NO_CONNECTED_INPUT';

export type PracticeMicrophoneCapability =
  | { supported: true; status: 'READY'; reason?: undefined }
  | { supported: false; status: 'BROWSER_UNSUPPORTED'; reason: 'BROWSER_UNSUPPORTED' }
  | { supported: false; status: 'MODEL_URL_NOT_CONFIGURED'; reason: 'MODEL_URL_NOT_CONFIGURED' };

export type PracticeMidiCapability =
  | { supported: true; status: 'READY'; reason?: undefined }
  | { supported: false; status: 'BROWSER_UNSUPPORTED'; reason: 'BROWSER_UNSUPPORTED' }
  | { supported: false; status: 'NO_CONNECTED_INPUT'; reason: 'NO_CONNECTED_INPUT' };

export type PracticeInputCapabilities = {
  microphone: PracticeMicrophoneCapability;
  midi: PracticeMidiCapability;
};

export type EvaluatePracticeInputOptions = {
  connectedMidiInputs?: number;
};

export function evaluatePracticeInputCapabilities(
  options?: EvaluatePracticeInputOptions
): PracticeInputCapabilities {
  if (typeof window === 'undefined') {
    return {
      microphone: { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' },
      midi: { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' },
    };
  }

  // Evaluate Microphone
  const hasAudioContext =
    typeof (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) !==
    'undefined';
  const hasAudioWorklet = typeof AudioWorkletNode !== 'undefined';
  const hasGetUserMedia =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const isBrowserAudioSupported = hasAudioContext && hasAudioWorklet && hasGetUserMedia;

  const modelUrl = productionByteDanceModelUrl();
  const isModelConfigured = Boolean(modelUrl && modelUrl.trim().length > 0);

  let microphone: PracticeMicrophoneCapability;
  if (!isBrowserAudioSupported) {
    microphone = { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
  } else if (!isModelConfigured) {
    microphone = { supported: false, status: 'MODEL_URL_NOT_CONFIGURED', reason: 'MODEL_URL_NOT_CONFIGURED' };
  } else {
    microphone = { supported: true, status: 'READY' };
  }

  // Evaluate MIDI (completely independent of AudioWorklet or microphone model)
  const isMidiSupported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

  let midi: PracticeMidiCapability;
  if (!isMidiSupported) {
    midi = { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
  } else if (options?.connectedMidiInputs !== undefined && options.connectedMidiInputs === 0) {
    midi = { supported: false, status: 'NO_CONNECTED_INPUT', reason: 'NO_CONNECTED_INPUT' };
  } else {
    midi = { supported: true, status: 'READY' };
  }

  return { microphone, midi };
}

export function getSelectedInputCapability(
  inputSource: PracticeInputSource,
  capabilities: PracticeInputCapabilities
): PracticeMicrophoneCapability | PracticeMidiCapability {
  return inputSource === 'MICROPHONE' ? capabilities.microphone : capabilities.midi;
}

export function isInputSourceSupported(
  inputSource: PracticeInputSource,
  capabilities: PracticeInputCapabilities
): boolean {
  return getSelectedInputCapability(inputSource, capabilities).supported;
}
