import { DeviceFailure, AudioContextFailure } from '@/lib/practice/failure/causal-failure';
import type { PracticeDeviceHealth } from '@/lib/practice/device/device-contract';
export type MicrophoneResourceHealth = Readonly<{
  healthy: boolean;
  reason: 'MICROPHONE_SOURCE_LOST' | 'AUDIO_CONTEXT_INTERRUPTED' | 'CAPTURE_PIPELINE_INVALID';
  recoverability: 'SAME_PIPELINE_RECOVERABLE' | 'RESTART_REQUIRED';
}>;

/** Combines supplied physical-source facts with the owned canonical clock pipeline. */
export class ContinuousMicrophoneHealth {
  private sourceHealth: PracticeDeviceHealth | null;
  private hard = false;
  private disposed = false;
  private previous: string;
  constructor(sourceHealth: PracticeDeviceHealth, private readonly context: AudioContext, private readonly changed: (health: MicrophoneResourceHealth) => void) {
    this.sourceHealth = sourceHealth;
    if (!this.snapshot().healthy) throw this.sourceHealth !== 'HEALTHY'
      ? new DeviceFailure('SOURCE_LOST', 'MICROPHONE') : new AudioContextFailure(context.state === 'closed' ? 'CLOSED' : 'INTERRUPTED');
    this.previous = JSON.stringify(this.snapshot());
    context.addEventListener('statechange', this.observe);
  }
  snapshot(): MicrophoneResourceHealth {
    this.hard ||= this.context.state === 'closed';
    const sourceLost = this.sourceHealth !== null && this.sourceHealth !== 'HEALTHY';
    const sourceEnded = this.sourceHealth === 'LOST';
    return Object.freeze({ healthy: !this.hard && !sourceLost && this.context.state === 'running',
      reason: sourceLost ? 'MICROPHONE_SOURCE_LOST' : 'AUDIO_CONTEXT_INTERRUPTED',
      recoverability: this.hard || sourceEnded ? 'RESTART_REQUIRED' : 'SAME_PIPELINE_RECOVERABLE' });
  }
  observeSourceHealth(health: PracticeDeviceHealth): void {
    if (this.sourceHealth === null || this.disposed) return;
    this.sourceHealth = health; this.observe();
  }
  private readonly observe = () => {
    if (this.disposed) return;
    const health = this.snapshot(), identity = JSON.stringify(health);
    if (identity !== this.previous) { this.previous = identity; this.changed(health); }
  };
  /** One-way release of analysis-source observation; the performance clock remains watched. */
  releaseAnalysisSource(): void {
    this.sourceHealth = null; this.observe();
  }
  dispose(): void {
    this.disposed = true;
    this.context.removeEventListener('statechange', this.observe);
  }
}
