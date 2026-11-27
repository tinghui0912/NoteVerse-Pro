import type { PracticeIntent } from './intent';

export type PracticeQualificationRequirement = 'browserAudio' | 'microphone' | 'acousticEngine'
  | 'midi' | 'camera' | 'audioRecording' | 'videoRecording';
export type PracticeLiveRoot = 'inputMicrophone' | 'recordingMicrophone' | 'camera' | 'midi';
type PracticeInputResourcePlan = Readonly<{ kind: 'MICROPHONE'; root: 'inputMicrophone' }>
  | Readonly<{ kind: 'MIDI'; root: 'midi' }>;
export type PracticeAnalysisResourcePlan = Readonly<{ kind: 'NONE' }>
  | Readonly<{ kind: 'ACOUSTIC'; sourceRoot: 'inputMicrophone' }>;
type PracticeRecordingResourcePlan = Readonly<{ mode: 'OFF' }>
  | Readonly<{ mode: 'AUDIO'; audioRoot: 'inputMicrophone' | 'recordingMicrophone' }>
  | Readonly<{ mode: 'VIDEO'; audioRoot: 'inputMicrophone' | 'recordingMicrophone'; videoRoot: 'camera' }>;
export type PracticeResourcePlan = Readonly<{
  qualification: readonly PracticeQualificationRequirement[];
  liveRoots: readonly PracticeLiveRoot[];
  input: PracticeInputResourcePlan;
  analysis: PracticeAnalysisResourcePlan;
  recording: PracticeRecordingResourcePlan;
}>;

/** Pure resource semantics; the finite immutable plans also retain stable projection identities. */
export function planPracticeResources(
  intent: Pick<PracticeIntent, 'mode' | 'inputSource' | 'recordingMode'>,
): PracticeResourcePlan {
  if (!intent || !['STEP_BY_STEP', 'CONTINUOUS_PLAY'].includes(intent.mode)
    || !['MICROPHONE', 'MIDI'].includes(intent.inputSource)
    || !['OFF', 'AUDIO', 'VIDEO'].includes(intent.recordingMode)
    || (intent.mode === 'STEP_BY_STEP' && intent.recordingMode !== 'OFF')) {
    throw new Error('Invalid Practice resource intent.');
  }
  return plans[intent.inputSource][intent.recordingMode];
}

/** Compare resource requirements by value; callers need no interned plan references. */
export function samePracticeResourcePlan(a: PracticeResourcePlan, b: PracticeResourcePlan): boolean {
  const value = (plan: PracticeResourcePlan) => JSON.stringify([
    plan.input.kind, plan.input.root,
    plan.analysis.kind, plan.analysis.kind === 'ACOUSTIC' ? plan.analysis.sourceRoot : null,
    plan.recording.mode, plan.recording.mode === 'OFF' ? null : plan.recording.audioRoot,
    plan.recording.mode === 'VIDEO' ? plan.recording.videoRoot : null,
    [...plan.qualification].sort(), [...plan.liveRoots].sort(),
  ]);
  return value(a) === value(b);
}

function resources(inputSource: 'MICROPHONE' | 'MIDI', mode: 'OFF' | 'AUDIO' | 'VIDEO'): PracticeResourcePlan {
  const input: PracticeInputResourcePlan = inputSource === 'MICROPHONE'
    ? Object.freeze({ kind: 'MICROPHONE', root: 'inputMicrophone' }) : Object.freeze({ kind: 'MIDI', root: 'midi' });
  const analysis: PracticeAnalysisResourcePlan = input.kind === 'MICROPHONE'
    ? Object.freeze({ kind: 'ACOUSTIC', sourceRoot: input.root }) : Object.freeze({ kind: 'NONE' });
  const qualification: PracticeQualificationRequirement[] = input.kind === 'MICROPHONE'
    ? ['acousticEngine', 'browserAudio', 'microphone'] : ['midi'];
  const liveRoots: PracticeLiveRoot[] = [input.root];
  let recording: PracticeRecordingResourcePlan = Object.freeze({ mode: 'OFF' });
  if (mode !== 'OFF') {
    const audioRoot = input.kind === 'MICROPHONE' ? input.root : 'recordingMicrophone';
    if (audioRoot === 'recordingMicrophone') liveRoots.push(audioRoot);
    if (!qualification.includes('microphone')) qualification.push('microphone');
    qualification.push(mode === 'AUDIO' ? 'audioRecording' : 'videoRecording');
    if (mode === 'VIDEO') {
      liveRoots.push('camera'); qualification.push('camera');
      recording = Object.freeze({ mode, audioRoot, videoRoot: 'camera' });
    } else recording = Object.freeze({ mode, audioRoot });
  }
  return Object.freeze({ qualification: Object.freeze(qualification.sort()), liveRoots: Object.freeze(liveRoots),
    input, analysis, recording });
}
const plans = Object.freeze({
  MICROPHONE: Object.freeze({ OFF: resources('MICROPHONE', 'OFF'), AUDIO: resources('MICROPHONE', 'AUDIO'), VIDEO: resources('MICROPHONE', 'VIDEO') }),
  MIDI: Object.freeze({ OFF: resources('MIDI', 'OFF'), AUDIO: resources('MIDI', 'AUDIO'), VIDEO: resources('MIDI', 'VIDEO') }),
});
