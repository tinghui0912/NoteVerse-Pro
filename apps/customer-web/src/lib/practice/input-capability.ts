import { CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON } from './audio-analysis/continuous/transcription-contract';
import type { PracticeInputSource, PracticeMode } from './local-core/artifact';

type WindowWithWebKitAudioContext = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

export type PracticeMicrophoneCapability =
  | { supported: true; status: 'AVAILABLE'; reason?: undefined }
  | { supported: false; status: 'BROWSER_UNSUPPORTED'; reason: 'BROWSER_UNSUPPORTED' }
  | { supported: false; status: 'WEBGPU_UNAVAILABLE'; reason: 'WEBGPU_UNAVAILABLE' }
  | { supported: false; status: 'MODEL_ACCESS_UNAVAILABLE'; reason: 'MODEL_ACCESS_UNAVAILABLE' }
  | { supported: false; status: 'MODEL_STORAGE_UNAVAILABLE'; reason: 'MODEL_STORAGE_UNAVAILABLE' }
  | {
      supported: false;
      status: 'STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED';
      reason: 'STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED';
    }
  | {
      supported: false;
      status: 'CONTINUOUS_ANALYSIS_UNAVAILABLE';
      reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE';
    };

export type PracticeMidiCapability =
  | { supported: true; status: 'AVAILABLE'; reason?: undefined }
  | { supported: false; status: 'BROWSER_UNSUPPORTED'; reason: 'BROWSER_UNSUPPORTED' }
  | { supported: false; status: 'NO_CONNECTED_INPUT'; reason: 'NO_CONNECTED_INPUT' };

export type PracticeInputCapabilities = {
  microphone: PracticeMicrophoneCapability;
  midi: PracticeMidiCapability;
};

type ContinuousAcousticAnalysisCapability =
  | { status: 'MODEL_NOT_VALIDATED' }
  | { status: 'AVAILABLE' };

type StepAcousticAnalysisCapability =
  | { status: 'TRIGGER_NOT_VALIDATED' }
  | { status: 'AVAILABLE' };

const CONTINUOUS_ACOUSTIC_ANALYSIS_CAPABILITY: ContinuousAcousticAnalysisCapability = {
  status: 'MODEL_NOT_VALIDATED',
};

const STEP_ACOUSTIC_ANALYSIS_CAPABILITY: StepAcousticAnalysisCapability = {
  status: 'TRIGGER_NOT_VALIDATED',
};

export type EvaluatePracticeInputOptions = {
  connectedMidiInputs?: number;
  modelAccessAvailable?: boolean;
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
  const audioWindow = window as WindowWithWebKitAudioContext;
  const hasAudioContext =
    typeof (audioWindow.AudioContext || audioWindow.webkitAudioContext) !==
    'undefined';
  const hasAudioWorklet = typeof AudioWorkletNode !== 'undefined';
  const hasGetUserMedia =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const isBrowserAudioSupported = hasAudioContext && hasAudioWorklet && hasGetUserMedia;
  const hasWebGpu = typeof navigator !== 'undefined' && Boolean((navigator as Navigator & { gpu?: unknown }).gpu);

  const hasOpfs = typeof navigator !== 'undefined' && Boolean(navigator.storage?.getDirectory);
  const isModelAccessAvailable = options?.modelAccessAvailable !== false;

  let microphone: PracticeMicrophoneCapability;
  if (!isBrowserAudioSupported) {
    microphone = { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
  } else if (!hasWebGpu) {
    microphone = { supported: false, status: 'WEBGPU_UNAVAILABLE', reason: 'WEBGPU_UNAVAILABLE' };
  } else if (!hasOpfs) {
    microphone = { supported: false, status: 'MODEL_STORAGE_UNAVAILABLE', reason: 'MODEL_STORAGE_UNAVAILABLE' };
  } else if (!isModelAccessAvailable) {
    microphone = { supported: false, status: 'MODEL_ACCESS_UNAVAILABLE', reason: 'MODEL_ACCESS_UNAVAILABLE' };
  } else {
    microphone = { supported: true, status: 'AVAILABLE' };
  }

  // Evaluate MIDI (completely independent of AudioWorklet, OPFS, or microphone model)
  const isMidiSupported =
    typeof navigator !== 'undefined' &&
    typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';

  let midi: PracticeMidiCapability;
  if (!isMidiSupported) {
    midi = { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
  } else if (options?.connectedMidiInputs !== undefined && options.connectedMidiInputs === 0) {
    midi = { supported: false, status: 'NO_CONNECTED_INPUT', reason: 'NO_CONNECTED_INPUT' };
  } else {
    midi = { supported: true, status: 'AVAILABLE' };
  }

  return { microphone, midi };
}

export function getSelectedInputCapability(
  inputSource: PracticeInputSource,
  capabilities: PracticeInputCapabilities,
  mode?: PracticeMode
): PracticeMicrophoneCapability | PracticeMidiCapability {
  if (inputSource !== 'MICROPHONE') {
    return capabilities.midi;
  }
  if (
    mode === 'CONTINUOUS_PLAY'
    && capabilities.microphone.supported
    && CONTINUOUS_ACOUSTIC_ANALYSIS_CAPABILITY.status !== 'AVAILABLE'
  ) {
    return {
      supported: false,
      status: CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON,
      reason: CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON,
    };
  }
  if (
    mode === 'STEP_BY_STEP'
    && capabilities.microphone.supported
    && STEP_ACOUSTIC_ANALYSIS_CAPABILITY.status !== 'AVAILABLE'
  ) {
    return {
      supported: false,
      status: 'STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED',
      reason: 'STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED',
    };
  }
  return capabilities.microphone;
}

export function isInputSourceSupported(
  inputSource: PracticeInputSource,
  capabilities: PracticeInputCapabilities,
  mode?: PracticeMode
): boolean {
  return getSelectedInputCapability(inputSource, capabilities, mode).supported;
}
