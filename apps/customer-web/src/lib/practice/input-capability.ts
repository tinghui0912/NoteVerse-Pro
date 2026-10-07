import { CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON } from './input-capability-reasons';
import type { PracticeInputSource, PracticeMode } from './local-core/artifact';

type WindowWithWebKitAudioContext = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

export type PracticeMicrophoneCapability =
  | { supported: true; status: 'AVAILABLE'; reason?: undefined }
  | { supported: false; status: 'BROWSER_UNSUPPORTED'; reason: 'BROWSER_UNSUPPORTED' }
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

type MicrophoneCaptureCapability =
  | { supported: true; status: 'AVAILABLE'; reason?: undefined }
  | { supported: false; status: 'BROWSER_UNSUPPORTED'; reason: 'BROWSER_UNSUPPORTED' };

export type PracticeInputCapabilities = {
  /**
   * Browser-level PCM capture capability only. It answers whether this browser can
   * acquire microphone audio; it does not mean any Practice acoustic analyzer has
   * been validated for STEP or Continuous.
   */
  microphoneCapture: MicrophoneCaptureCapability;
  midi: PracticeMidiCapability;
  acousticAnalysis: {
    step: StepAcousticAnalysisCapability;
    continuous: ContinuousAcousticAnalysisCapability;
  };
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
};

export function evaluatePracticeInputCapabilities(
  options?: EvaluatePracticeInputOptions
): PracticeInputCapabilities {
  if (typeof window === 'undefined') {
    return {
      microphoneCapture: { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' },
      midi: { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' },
      acousticAnalysis: {
        step: STEP_ACOUSTIC_ANALYSIS_CAPABILITY,
        continuous: CONTINUOUS_ACOUSTIC_ANALYSIS_CAPABILITY,
      },
    };
  }

  // Evaluate browser microphone capture only. Model/runtime validation is mode-specific
  // and intentionally lives in acousticAnalysis below.
  const audioWindow = window as WindowWithWebKitAudioContext;
  const hasAudioContext =
    typeof (audioWindow.AudioContext || audioWindow.webkitAudioContext) !==
    'undefined';
  const hasAudioWorklet = typeof AudioWorkletNode !== 'undefined';
  const hasGetUserMedia =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  const isBrowserAudioSupported = hasAudioContext && hasAudioWorklet && hasGetUserMedia;

  let microphoneCapture: MicrophoneCaptureCapability;
  if (!isBrowserAudioSupported) {
    microphoneCapture = { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
  } else {
    microphoneCapture = { supported: true, status: 'AVAILABLE' };
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

  return {
    microphoneCapture,
    midi,
    acousticAnalysis: {
      step: STEP_ACOUSTIC_ANALYSIS_CAPABILITY,
      continuous: CONTINUOUS_ACOUSTIC_ANALYSIS_CAPABILITY,
    },
  };
}

export function getSelectedInputCapability(
  inputSource: PracticeInputSource,
  capabilities: PracticeInputCapabilities,
  mode: PracticeMode
): PracticeMicrophoneCapability | PracticeMidiCapability {
  if (inputSource !== 'MICROPHONE') {
    return capabilities.midi;
  }
  return getSelectedMicrophoneCapability(capabilities, mode);
}

export function getSelectedMicrophoneCapability(
  capabilities: PracticeInputCapabilities,
  mode: PracticeMode
): PracticeMicrophoneCapability {
  if (mode !== 'STEP_BY_STEP' && mode !== 'CONTINUOUS_PLAY') {
    throw new Error('PracticeMode is required to resolve product microphone availability.');
  }
  if (!capabilities.microphoneCapture.supported) {
    return capabilities.microphoneCapture;
  }
  if (
    mode === 'CONTINUOUS_PLAY'
    && capabilities.acousticAnalysis.continuous.status !== 'AVAILABLE'
  ) {
    return {
      supported: false,
      status: CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON,
      reason: CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON,
    };
  }
  if (
    mode === 'STEP_BY_STEP'
    && capabilities.acousticAnalysis.step.status !== 'AVAILABLE'
  ) {
    return {
      supported: false,
      status: 'STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED',
      reason: 'STEP_ACOUSTIC_TRIGGER_NOT_VALIDATED',
    };
  }
  return capabilities.microphoneCapture;
}

export function isInputSourceSupported(
  inputSource: PracticeInputSource,
  capabilities: PracticeInputCapabilities,
  mode: PracticeMode
): boolean {
  return getSelectedInputCapability(inputSource, capabilities, mode).supported;
}
