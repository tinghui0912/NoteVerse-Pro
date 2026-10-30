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
      if (typeof navigator.requestMIDIAccess !== 'function') throw new Error('MIDI_UNSUPPORTED');
      let access: MIDIAccess;
      try { access = await navigator.requestMIDIAccess({ sysex: false }); }
      catch (error) { throw new Error(error instanceof DOMException && error.name === 'NotAllowedError' ? 'MIDI_PERMISSION_DENIED' : 'MIDI_UNAVAILABLE'); }
      check();
      if (![...access.inputs.values()].some(input => input.state === 'connected')) throw new Error('NO_CONNECTED_INPUT');
      ready('midi');
    }
    if (needs('microphone')) {
      try { microphone = await navigator.mediaDevices.getUserMedia({ video: false,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }); }
      catch (error) { throw new Error(error instanceof DOMException && error.name === 'NotAllowedError' ? 'MICROPHONE_PERMISSION_DENIED' : 'MICROPHONE_UNAVAILABLE'); }
      check();
      if (!microphone.getAudioTracks().some(track => track.readyState === 'live' && !track.muted)) throw new Error('MICROPHONE_UNAVAILABLE');
      if (needs('browserAudio')) {
        context = new AudioContext(); await context.resume(); check();
        if (context.state !== 'running') throw new Error('AUDIO_CONTEXT_INTERRUPTED');
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
      try { camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }); }
      catch (error) { throw new Error(error instanceof DOMException && error.name === 'NotAllowedError' ? 'CAMERA_PERMISSION_DENIED' : 'CAMERA_UNAVAILABLE'); }
      check();
      if (!camera.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('CAMERA_UNAVAILABLE');
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
