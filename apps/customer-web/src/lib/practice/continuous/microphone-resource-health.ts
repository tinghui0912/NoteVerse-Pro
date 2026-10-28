export type MicrophoneResourceHealth = Readonly<{
  healthy: boolean;
  reason: 'MICROPHONE_SOURCE_LOST' | 'AUDIO_CONTEXT_INTERRUPTED' | 'CAPTURE_PIPELINE_INVALID';
  recoverability: 'SAME_PIPELINE_RECOVERABLE' | 'RESTART_REQUIRED';
}>;

/** Watches borrowed analysis source and canonical clock health; never reacquires or resumes them. */
export class ContinuousMicrophoneResources {
  private tracks: MediaStreamTrack[] | null;
  private hard = false;
  private disposed = false;
  private previous: string;
  constructor(stream: MediaStream, private readonly context: AudioContext, private readonly changed: (health: MicrophoneResourceHealth) => void) {
    this.tracks = stream.getAudioTracks();
    if (!this.snapshot().healthy) throw new Error(this.snapshot().reason);
    this.previous = JSON.stringify(this.snapshot());
    for (const track of this.tracks ?? []) for (const event of ['mute', 'unmute', 'ended']) track.addEventListener(event, this.observe);
    context.addEventListener('statechange', this.observe);
  }
  snapshot(): MicrophoneResourceHealth {
    this.hard ||= this.context.state === 'closed';
    const sourceLost = this.tracks !== null && (!this.tracks.length || this.tracks.some(track => track.readyState !== 'live' || track.muted));
    const sourceEnded = this.tracks !== null && (!this.tracks.length || this.tracks.some(track => track.readyState !== 'live'));
    return Object.freeze({ healthy: !this.hard && !sourceLost && this.context.state === 'running',
      reason: sourceLost ? 'MICROPHONE_SOURCE_LOST' : 'AUDIO_CONTEXT_INTERRUPTED',
      recoverability: this.hard || sourceEnded ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE' });
  }
  private readonly observe = () => {
    if (this.disposed) return;
    const health = this.snapshot(), identity = JSON.stringify(health);
    if (identity !== this.previous) { this.previous = identity; this.changed(health); }
  };
  /** One-way release of analysis-source observation; the performance clock remains watched. */
  releaseAnalysisSource(): void {
    for (const track of this.tracks ?? []) for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, this.observe);
    this.tracks = null; this.observe();
  }
  dispose(): void {
    this.disposed = true;
    for (const track of this.tracks ?? []) for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, this.observe);
    this.context.removeEventListener('statechange', this.observe);
  }
}
