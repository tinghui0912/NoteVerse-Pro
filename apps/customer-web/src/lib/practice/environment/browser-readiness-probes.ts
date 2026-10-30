import { browserDevicePlatform } from '@/lib/practice/device/browser-device-platform';
import { DeviceFailure, MidiFailure, AudioContextFailure } from '@/lib/practice/failure/causal-failure';
import { createPracticeAudioContext, resumePracticeAudioContext } from '@/lib/practice/failure/browser-failures';
import { browserMicrophoneCapture } from '@/lib/practice/acoustic/source/browser-microphone-platform';
import { QualifiedSourceAdapter } from '@/lib/practice/acoustic/source/source-adapter';
import { probeRecording } from '@/lib/practice/recording/recorder-capability';
import type { PracticeQualificationRequirement } from '@/lib/practice/planning/resource-plan';

export async function probePracticeRequirements(requirements: readonly PracticeQualificationRequirement[],
  ready: (requirement: PracticeQualificationRequirement) => void, signal: AbortSignal): Promise<void> {
  const needs = (requirement: PracticeQualificationRequirement) => requirements.includes(requirement);
  const check = () => { if (signal.aborted) throw new Error('PRACTICE_PREPARATION_CANCELLED'); };
  let microphone: MediaStream | null = null, camera: MediaStream | null = null;
  let context: AudioContext | null = null, capture: { stop(): void } | null = null;
  try {
    if (needs('midi')) {
      const access = await browserDevicePlatform.acquireMidi();
      check();
      if (![...access.inputs.values()].some(input => input.state === 'connected')) throw new MidiFailure('NO_CONNECTED_INPUT');
      ready('midi');
    }
    if (needs('microphone')) {
      microphone = await browserDevicePlatform.acquireStream('inputMicrophone');
      check();
      if (!microphone.getAudioTracks().some(track => track.readyState === 'live' && !track.muted)) throw new DeviceFailure('UNAVAILABLE', 'MICROPHONE');
      if (needs('browserAudio')) {
        context = createPracticeAudioContext(); await resumePracticeAudioContext(context); check();
        if (context.state !== 'running') throw new AudioContextFailure(context.state === 'closed' ? 'CLOSED' : 'INTERRUPTED');
        const adapter = await QualifiedSourceAdapter.create(context.sampleRate, await browserMicrophoneCapture.coefficients(context.sampleRate)); check();
        capture = await browserMicrophoneCapture.connectCapture({ context, stream: microphone, ownership: 'BORROWED_SESSION_STREAM',
          workletUrl: browserMicrophoneCapture.workletUrl, bridge: {
            receive: chunk => { adapter.push(chunk.samples); },
            abort: () => {}, attachCaptureCleanup: () => () => {},
          } }); check();
        ready('browserAudio');
      }
      ready('microphone');
    }
    if (needs('camera')) {
      camera = await browserDevicePlatform.acquireStream('camera');
      check();
      if (!camera.getVideoTracks().some(track => track.readyState === 'live')) throw new DeviceFailure('UNAVAILABLE', 'CAMERA');
      ready('camera');
    }
    if (needs('audioRecording') || needs('videoRecording')) {
      const mode = needs('videoRecording') ? 'VIDEO' : 'AUDIO';
      const stream = new MediaStream([...(microphone?.getAudioTracks() ?? []), ...(camera?.getVideoTracks() ?? [])]);
      await probeRecording(mode, stream); check();
      ready(mode === 'VIDEO' ? 'videoRecording' : 'audioRecording');
    }
  } finally {
    capture?.stop();
    for (const stream of [microphone, camera]) stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== 'closed') await context.close();
  }
}
