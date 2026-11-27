import type { PracticeResourcePlan } from '@/lib/practice/planning/resource-plan';

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
  acousticAnalysis: { status: 'BROWSER_UNSUPPORTED' | 'AVAILABLE' };
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
      acousticAnalysis: { status: 'BROWSER_UNSUPPORTED' },
    };
  }

  // Capture facts and acoustic worker prerequisites have separate capability projections.
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
  const acousticAnalysis: PracticeInputCapabilities['acousticAnalysis'] = {
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
    acousticAnalysis,
  };
}

/** Selected performance input only; recording qualification is owned by Setup. */
export function getSelectedInputCapability(
  resources: Pick<PracticeResourcePlan, 'input' | 'analysis'>,
  capabilities: PracticeInputCapabilities,
): PracticeMicrophoneCapability | PracticeMidiCapability {
  if (resources.input.kind === 'MIDI') return capabilities.midi;
  if (!capabilities.microphoneCapture.supported) return capabilities.microphoneCapture;
  if (resources.analysis.kind === 'ACOUSTIC' && capabilities.acousticAnalysis.status !== 'AVAILABLE') {
    return { supported: false, status: 'BROWSER_UNSUPPORTED', reason: 'BROWSER_UNSUPPORTED' };
  }
  return capabilities.microphoneCapture;
}
