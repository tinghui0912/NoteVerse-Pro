import type { MicrophoneInfrastructureErrorCode } from './microphone-errors';
/** Reports facts only; the owning mode decides the product consequence. */
export function watchMicrophoneInfrastructure(stream: MediaStream, context: AudioContext,
  onLoss: (code: Exclude<MicrophoneInfrastructureErrorCode, 'MICROPHONE_PERMISSION_DENIED'>) => void): () => void {
  const tracks = stream.getAudioTracks();
  const sourceLost = () => onLoss('MICROPHONE_SOURCE_LOST');
  const contextChanged = () => { if (context.state !== 'running') onLoss('AUDIO_CONTEXT_INTERRUPTED'); };
  if (!tracks.length || tracks.some(track => track.readyState !== 'live' || track.muted)) throw new Error('MICROPHONE_SOURCE_LOST');
  if (context.state !== 'running') throw new Error('AUDIO_CONTEXT_INTERRUPTED');
  for (const track of tracks) { track.addEventListener('ended', sourceLost); track.addEventListener('mute', sourceLost); }
  context.addEventListener('statechange', contextChanged);
  return () => {
    for (const track of tracks) { track.removeEventListener('ended', sourceLost); track.removeEventListener('mute', sourceLost); }
    context.removeEventListener('statechange', contextChanged);
  };
}
