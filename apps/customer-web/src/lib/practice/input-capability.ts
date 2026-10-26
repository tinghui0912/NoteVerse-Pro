import type { PracticeInputSource, PracticeMode } from '@/lib/practice/kernel/session';

type WindowWithWebKitAudioContext = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

export type PracticeMicrophoneCapability =
  | { supported: true; status: 'AVAILABLE'; reason?: undefined }
  | { supported: false; status: 'BROWSER_UNSUPPORTED'; reason: 'BROWSER_UNSUPPORTED' };

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
  | { status: 'BROWSER_UNSUPPORTED' }
  | { status: 'AVAILABLE' };

type StepAcousticAnalysisCapability =
  | { status: 'BROWSER_UNSUPPORTED' }
  | { status: 'AVAILABLE' };

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
        step: { status: 'BROWSER_UNSUPPORTED' },
        continuous: { status: 'BROWSER_UNSUPPORTED' },
      },
    };
  }

  // Evaluate browser microphone capture only. Model/runtime validation is mode-specific
  // and intentionally lives in acousticAnalysis below.
  const audioWindow = window as WindowWithWebKitAudioContext;
  const hasAudioContext =
    typeof (audioWindow.AudioContext || audioWindow.webkitAudioContext) === 'function';
  const hasAudioWorklet = typeof AudioWorkletNode === 'function';
  const hasGetUserMedia =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
  const isBrowserAudioSupported = hasAudioContext && hasAudioWorklet && hasGetUserMedia;

  let microphoneCapture: MicrophoneCaptureCapability;
  if (!isBrowserAudioSupported) {
    microphoneCapture = { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
  } else {
    microphoneCapture = { supported: true, status: 'AVAILABLE' };
  }

  // Both acoustic modes use the standard context constructor and verified worker-backed
  // model loading; PCM capture alone does not establish these prerequisites.
  const gpu = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { gpu?: { requestAdapter?: unknown } }).gpu;
  const hasAcousticRuntime = isBrowserAudioSupported
    && typeof audioWindow.AudioContext === 'function'
    && typeof Worker === 'function'
    && typeof gpu?.requestAdapter === 'function'
    && typeof navigator.storage?.getDirectory === 'function'
    && typeof crypto !== 'undefined'
    && typeof crypto.subtle?.digest === 'function';
  const continuous: ContinuousAcousticAnalysisCapability = {
    status: hasAcousticRuntime ? 'AVAILABLE' : 'BROWSER_UNSUPPORTED',
  };

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
      step: { status: hasAcousticRuntime ? 'AVAILABLE' : 'BROWSER_UNSUPPORTED' },
      continuous,
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

function getSelectedMicrophoneCapability(
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
      status: 'BROWSER_UNSUPPORTED',
      reason: 'BROWSER_UNSUPPORTED',
    };
  }
  if (
    mode === 'STEP_BY_STEP'
    && capabilities.acousticAnalysis.step.status !== 'AVAILABLE'
  ) {
    return { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
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
