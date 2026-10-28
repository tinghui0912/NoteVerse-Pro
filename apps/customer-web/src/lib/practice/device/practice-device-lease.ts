import { practiceDeviceRequirements, type PracticeDeviceConfiguration, type PracticeDeviceHealth,
  type PracticeDeviceResource, type PracticeDeviceRoots, type PracticeDeviceIssue } from './device-contract';
import { browserDevicePlatform, type PracticeDevicePlatform } from './browser-device-platform';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';

/** Exact Practice-page owner. Attempts borrow these roots and never dispose them. */
export class PracticeDeviceLease {
  private roots: { -readonly [K in keyof PracticeDeviceRoots]: PracticeDeviceRoots[K] } = {
    inputMicrophone: null, recordingMicrophone: null, camera: null, midi: null,
  };
  private state: 'NEW' | 'OPENING' | 'READY' | 'FAULTED' | 'CLOSED' = 'NEW';
  private issue: PracticeDeviceIssue | null = null;
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
    return Object.freeze({ state: this.state, issue: this.issue, roots: Object.freeze({ ...this.roots }), health: Object.freeze(health) });
  }
  engineeringSnapshot() { return this.timings.snapshot(); }
  /** One binding transaction per mounted execution page; faults never reacquire roots. */
  open(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state === 'CLOSED') return Promise.reject(new Error('PRACTICE_DEVICE_LEASE_CLOSED'));
    if (this.state !== 'NEW') return this.state === 'READY' ? Promise.resolve() : Promise.reject(new Error('PRACTICE_DEVICE_UNAVAILABLE'));
    this.state = 'OPENING'; this.notify();
    this.pending = this.timings.measure('deviceLeaseOpen', async () => {
      const acquired: PracticeDeviceResource[] = [];
      let opening = this.required[0];
      try {
        for (const resource of this.required) {
          if (this.state === 'CLOSED') return;
          opening = resource;
          if (resource === 'midi') {
            const access = await this.platform.acquireMidi();
            if (this.isClosed()) return;
            this.roots.midi = access;
            acquired.push(resource);
            const changed = () => this.changed();
            access.addEventListener('statechange', changed);
            this.detach.set(resource, () => access.removeEventListener('statechange', changed));
          } else {
            const stream = await this.platform.acquireStream(resource);
            if (this.isClosed()) { stream.getTracks().forEach(track => track.stop()); return; }
            this.roots[resource] = stream;
            acquired.push(resource);
            const changed = () => this.changed();
            const tracks = stream.getTracks();
            for (const track of tracks) for (const event of ['mute', 'unmute', 'ended']) track.addEventListener(event, changed);
            this.detach.set(resource, () => { for (const track of tracks) for (const event of ['mute', 'unmute', 'ended']) track.removeEventListener(event, changed); });
          }
        }
        const unhealthy = this.required.find(resource => this.health(resource) !== 'HEALTHY');
        if (unhealthy) {
          this.issue = Object.freeze({ resource: unhealthy, phase: 'RUNTIME', condition: this.health(unhealthy) === 'INTERRUPTED' ? 'INTERRUPTED' : 'LOST' });
          throw new Error('PRACTICE_DEVICE_UNAVAILABLE');
        }
        this.changed();
      } catch (error) {
        for (const resource of acquired) this.release(resource);
        if (!this.isClosed()) {
          const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
          this.issue ??= Object.freeze({ resource: opening, phase: 'OPEN', condition: name === 'NotAllowedError' ? 'PERMISSION_DENIED'
            : name === 'NotFoundError' ? 'NOT_FOUND' : name === 'NotReadableError' ? 'BUSY' : 'UNAVAILABLE' });
          this.state = 'FAULTED'; this.notify();
        }
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
    // Keep failed binding facts for this mounted lease; only a new page can bind again.
    const failedOpen = this.issue?.phase === 'OPEN' && !this.roots[this.issue.resource] ? this.issue : null;
    const resource = this.required.find(resource => this.health(resource) !== 'HEALTHY');
    this.issue = failedOpen ?? (resource ? Object.freeze({ resource, phase: 'RUNTIME',
      condition: this.health(resource) === 'INTERRUPTED' ? 'INTERRUPTED' : 'LOST' }) : null);
    this.state = this.issue ? 'FAULTED' : 'READY'; this.notify();
  }
  private notify(): void { for (const listener of this.listeners) listener(); }
}
