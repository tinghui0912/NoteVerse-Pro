import type { PracticeResourcePlan, PracticeQualificationRequirement } from '@/lib/practice/planning/resource-plan';
import type { PracticeDeviceRoots } from '@/lib/practice/device/device-contract';
import type { PracticeEnvironment } from './practice-environment';
import { DeviceFailure, MidiFailure } from '@/lib/practice/failure/causal-failure';
import { evaluatePracticeInputCapabilities, getSelectedInputCapability } from '@/lib/practice/input-capability';
import { probeRecording } from '@/lib/practice/recording/recorder-capability';

/** Preflight uses only the acquired roots. Temporary recording tracks are clones. */
export async function validatePracticeResources(options: {
  plan: PracticeResourcePlan; roots: PracticeDeviceRoots; environment: PracticeEnvironment; signal: AbortSignal;
  onComponent: (key: PracticeQualificationRequirement) => void; onProgress?: (percent: number | null) => void;
}): Promise<void> {
  const { plan, roots, environment, signal, onComponent } = options;
  signal.throwIfAborted();
  const capabilities = evaluatePracticeInputCapabilities({ connectedMidiInputs: roots.midi
    ? [...roots.midi.inputs.values()].filter(input => input.state === 'connected').length : undefined });
  if (!getSelectedInputCapability(plan, capabilities).supported) {
    if (plan.input.kind === 'MIDI') throw new MidiFailure('UNSUPPORTED');
    throw new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
  }
  if (plan.input.kind === 'MIDI') {
    if (!roots[plan.input.root] || ![...roots[plan.input.root]!.inputs.values()].some(input => input.state === 'connected')) throw new MidiFailure('NO_CONNECTED_INPUT');
    onComponent('midi');
  }
  for (const root of plan.liveRoots) {
    if (root === 'midi') continue;
    const tracks = root === 'camera' ? roots[root]?.getVideoTracks() : roots[root]?.getAudioTracks();
    if (!tracks?.length || tracks.some(track => track.readyState !== 'live' || track.muted)) throw new DeviceFailure('UNAVAILABLE', root === 'camera' ? 'CAMERA' : 'MICROPHONE');
    onComponent(root === 'camera' ? 'camera' : 'microphone');
  }
  if (plan.analysis.kind === 'ACOUSTIC') {
    const inputMicrophone = roots[plan.analysis.sourceRoot];
    if (!inputMicrophone) throw new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
    await environment.validateAcoustic({ inputMicrophone, signal, onProgress: options.onProgress });
    signal.throwIfAborted(); onComponent('browserAudio'); onComponent('acousticEngine');
  }
  const recording = plan.recording;
  if (recording.mode !== 'OFF') {
    const clones: MediaStreamTrack[] = [];
    try {
      for (const track of roots[recording.audioRoot]?.getAudioTracks() ?? []) clones.push(track.clone());
      if (recording.mode === 'VIDEO') for (const track of roots[recording.videoRoot]?.getVideoTracks() ?? []) clones.push(track.clone());
      await probeRecording(recording.mode, new MediaStream(clones)); signal.throwIfAborted();
      onComponent(recording.mode === 'VIDEO' ? 'videoRecording' : 'audioRecording');
    } finally { for (const track of clones) track.stop(); }
  }
}
