import { practiceDeviceRequirements, type PracticeDeviceConfiguration, type PracticeDeviceHealth,
  type PracticeDeviceResource, type PracticeDeviceRoots } from './device-contract';
import { browserDevicePlatform, type PracticeDevicePlatform } from './browser-device-platform';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';

/** Exact Practice-page owner. Attempts borrow these roots and never dispose them. */
export class PracticeDeviceLease {
  private roots: { -readonly [K in keyof PracticeDeviceRoots]: PracticeDeviceRoots[K] } = {
    inputMicrophone: null, recordingMicrophone: null, camera: null, midi: null,
  };
  private state: 'NEW' | 'OPENING' | 'READY' | 'FAULTED' | 'CLOSED' = 'NEW';
  private error: string | null = null;
  private readonly required: readonly PracticeDeviceResource[];
  private readonly listeners = new Set<() => void>();
  private readonly detach = new Map<PracticeDeviceResource, () => void>();
  private pending: Promise<void> | null = null;
  private readonly timings = new PracticeStartupTimings();
  constructor(configuration: PracticeDeviceConfiguration, private readonly platform: PracticeDevicePlatform = browserDevicePlatform) {
    this.required = practiceDeviceRequirements(configuration);
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot() {
    const health = Object.fromEntries(this.required.map(resource => [resource, this.health(resource)])) as Partial<Record<PracticeDeviceResource, PracticeDeviceHealth>>;
    return Object.freeze({ state: this.state, error: this.error, roots: Object.freeze({ ...this.roots }), health: Object.freeze(health) });
  }
  engineeringSnapshot() { return this.timings.snapshot(); }
  open(): Promise<void> { return this.bind(false); }
  /** Explicit restart renews lost roots only; temporary mute waits on the same roots. */
  renewFailed(): Promise<void> { return this.bind(true); }
  private bind(renew: boolean): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state === 'CLOSED') return Promise.reject(new Error('PRACTICE_DEVICE_LEASE_CLOSED'));
    this.state = 'OPENING'; this.error = null; this.notify();
    this.pending = this.timings.measure('deviceLeaseOpen', async () => {
      try {
        for (const resource of this.required) {
          if (this.state === 'CLOSED') return;
          if (this.roots[resource] && (!renew || this.health(resource) !== 'LOST')) continue;
          this.release(resource);
          if (resource === 'midi') {
            const access = await this.platform.acquireMidi();
            if (this.isClosed()) return;
            this.roots.midi = access;
            const changed = () => this.changed();
            access.addEventListener('statechange', changed);
            this.detach.set(resource, () => access.removeEventListener('statechange', changed));
          } else {
            const stream = await this.platform.acquireStream(resource);
            if (this.isClosed()) { stream.getTracks().forEach(track => track.stop()); return; }
            this.roots[resource] = stream;
            const changed = () => this.changed();
            const tracks = stream.getTracks();
            for (const track of tracks) for (const event of ['mute', 'unmute', 'ended']) track.addEventListener(event, changed);
            this.detach.set(resource, () => { for (const track of tracks) for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, changed); });
          }
        }
        this.changed();
        if (this.required.some(resource => this.health(resource) !== 'HEALTHY')) throw new Error('PRACTICE_DEVICE_UNAVAILABLE');
      } catch {
        if (!this.isClosed()) { this.error = 'PRACTICE_DEVICE_UNAVAILABLE'; this.state = 'FAULTED'; this.notify(); }
        throw new Error('PRACTICE_DEVICE_UNAVAILABLE');
      }
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  close(): void {
    if (this.isClosed()) return;
    this.state = 'CLOSED';
    for (const resource of this.required) this.release(resource);
    this.notify(); this.listeners.clear();
  }
  private isClosed(): boolean { return this.state === 'CLOSED'; }
  private release(resource: PracticeDeviceResource): void {
    this.detach.get(resource)?.(); this.detach.delete(resource);
    if (resource !== 'midi') this.roots[resource]?.getTracks().forEach(track => track.stop());
    this.roots[resource] = null;
  }
  private health(resource: PracticeDeviceResource): PracticeDeviceHealth {
    if (resource === 'midi') return this.roots.midi && [...this.roots.midi.inputs.values()].some(input => input.state === 'connected') ? 'HEALTHY' : 'LOST';
    const stream = this.roots[resource];
    const tracks = resource === 'camera' ? stream?.getVideoTracks() : stream?.getAudioTracks();
    if (!tracks?.length || tracks.some(track => track.readyState !== 'live')) return 'LOST';
    return tracks.some(track => track.muted) ? 'INTERRUPTED' : 'HEALTHY';
  }
  private changed(): void {
    if (this.isClosed()) return;
    this.state = this.required.every(resource => this.health(resource) === 'HEALTHY') ? 'READY' : 'FAULTED'; this.notify();
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
