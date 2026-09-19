import type { PracticeInputSource } from './local-core/artifact';

export type MicrophoneUnavailableReason =
  | 'BROWSER_UNSUPPORTED'
  | 'MODEL_URL_NOT_CONFIGURED';

export type MidiUnavailableReason = 'BROWSER_UNSUPPORTED';

export type PracticeMicrophoneCapability =
  | { supported: true; status: 'READY'; reason?: undefined }
  | { supported: false; status: 'UNAVAILABLE'; reason: MicrophoneUnavailableReason };

export type PracticeMidiCapability =
  | { supported: true; status: 'READY'; reason?: undefined }
  | { supported: false; status: 'UNAVAILABLE'; reason: MidiUnavailableReason };

export type PracticeInputCapabilities = {
  microphone: PracticeMicrophoneCapability;
  midi: PracticeMidiCapability;
};

export function evaluatePracticeInputCapabilities(): PracticeInputCapabilities {
  if (typeof window === 'undefined') {
    return {
      microphone: { supported: false, status: 'UNAVAILABLE', reason: 'BROWSER_UNSUPPORTED' },
      midi: { supported: false, status: 'UNAVAILABLE', reason: 'BROWSER_UNSUPPORTED' },
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

  const modelUrl =
    typeof process !== 'undefined' ? process.env?.NEXT_PUBLIC_BYTEDANCE_MODEL_URL : undefined;
  const isModelConfigured = Boolean(modelUrl && modelUrl.trim().length > 0);

  let microphone: PracticeMicrophoneCapability;
  if (!isBrowserAudioSupported) {
    microphone = { supported: false, status: 'UNAVAILABLE', reason: 'BROWSER_UNSUPPORTED' };
  } else if (!isModelConfigured) {
    microphone = { supported: false, status: 'UNAVAILABLE', reason: 'MODEL_URL_NOT_CONFIGURED' };
  } else {
    microphone = { supported: true, status: 'READY' };
  }

  // Evaluate MIDI (completely independent of AudioWorklet or microphone model)
  const isMidiSupported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

  let midi: PracticeMidiCapability;
  if (!isMidiSupported) {
    midi = { supported: false, status: 'UNAVAILABLE', reason: 'BROWSER_UNSUPPORTED' };
  } else {
    midi = { supported: true, status: 'READY' };
  }

  return { microphone, midi };
}

export function isInputSourceSupported(
  inputSource: PracticeInputSource,
  capabilities: PracticeInputCapabilities
): boolean {
  return inputSource === 'MICROPHONE'
    ? capabilities.microphone.supported
    : capabilities.midi.supported;
}
