import { AudioContextFailure, DeviceFailure, MidiFailure, RecordingFailure } from './causal-failure';

/** Browser exception names are interpreted only at browser API boundaries. */
export function mediaDeviceFailure(cause: unknown, resource: 'MICROPHONE' | 'CAMERA'): DeviceFailure {
  const name = cause instanceof DOMException ? cause.name : null;
  return new DeviceFailure(name === 'NotAllowedError' ? 'PERMISSION_DENIED' : name === 'NotFoundError' ? 'NOT_FOUND'
    : name === 'NotReadableError' ? 'BUSY' : 'UNAVAILABLE', resource, { cause });
}
export function midiAccessFailure(cause: unknown): MidiFailure {
  return cause instanceof MidiFailure ? cause : new MidiFailure(cause instanceof DOMException && cause.name === 'NotAllowedError'
    ? 'PERMISSION_DENIED' : 'ACCESS_UNAVAILABLE', { cause });
}
export function createPracticeAudioContext(): AudioContext {
  if (typeof AudioContext === 'undefined') throw new AudioContextFailure('UNAVAILABLE');
  try { return new AudioContext(); } catch (cause) { throw new AudioContextFailure('UNAVAILABLE', { cause }); }
}
export async function resumePracticeAudioContext(context: AudioContext): Promise<void> {
  try { await context.resume(); } catch (cause) { throw new AudioContextFailure(context.state === 'closed' ? 'CLOSED' : 'RESUME_FAILED', { cause }); }
}
export function recordingBrowserFailure(cause: unknown): RecordingFailure {
  if (cause instanceof RecordingFailure) return cause;
  const name = cause instanceof DOMException ? cause.name : null;
  return new RecordingFailure(name === 'NotAllowedError' ? 'RECORDING_PERMISSION_DENIED'
    : name === 'NotFoundError' || name === 'NotReadableError' ? 'RECORDING_AUDIO_UNAVAILABLE' : 'RECORDER_INIT_FAILED', { cause });
}
