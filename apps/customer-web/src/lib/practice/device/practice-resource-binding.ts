import { DeviceFailure, MidiFailure } from '@/lib/practice/failure/causal-failure';
import type { PracticeResourcePlan, PracticeLiveRoot } from '@/lib/practice/planning/resource-plan';
import { type PracticeDeviceHealth,
  type PracticeRootHealthPort, type PracticeRootHealthSnapshot, type PracticeDeviceRoots, type PracticeDeviceIssue } from './device-contract';
import { browserDevicePlatform, type PracticeDevicePlatform } from './browser-device-platform';
import { PracticeStartupTimings } from '@/lib/practice/diagnostics/startup-timings';

/** Retained physical owner acquired by the explicit Setup command. Attempts only borrow roots. */
export class PracticeResourceBinding {
  private roots: { -readonly [K in keyof PracticeDeviceRoots]: PracticeDeviceRoots[K] } = {
    inputMicrophone: null, recordingMicrophone: null, camera: null, midi: null,
  };
  private state: 'NEW' | 'OPENING' | 'READY' | 'FAULTED' | 'CLOSED' = 'NEW';
  private issue: PracticeDeviceIssue | null = null;
  private readonly required: readonly PracticeLiveRoot[];
  private readonly healthListeners = new Set<(snapshot: PracticeRootHealthSnapshot) => void>();
  readonly rootHealth: PracticeRootHealthPort = Object.freeze({
    snapshot: () => Object.freeze({ health: this.snapshot().health }),
    subscribe: (listener: (snapshot: PracticeRootHealthSnapshot) => void) => {
      this.healthListeners.add(listener); listener(this.rootHealth.snapshot());
      return () => { this.healthListeners.delete(listener); };
    },
  });
  private readonly listeners = new Set<() => void>();
  private readonly detach = new Map<PracticeLiveRoot, () => void>();
  private pending: Promise<void> | null = null;
  private readonly timings = new PracticeStartupTimings();
  constructor(readonly resourcePlan: PracticeResourcePlan, private readonly platform: PracticeDevicePlatform = browserDevicePlatform) {
    this.required = resourcePlan.liveRoots;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  snapshot() {
    const health = Object.fromEntries(this.required.map(resource => [resource, this.health(resource)])) as Partial<Record<PracticeLiveRoot, PracticeDeviceHealth>>;
    return Object.freeze({ state: this.state, issue: this.issue, roots: Object.freeze({ ...this.roots }), health: Object.freeze(health) });
  }
  engineeringSnapshot() { return this.timings.snapshot(); }
  /** One acquisition transaction; faults never reacquire physical roots. */
  open(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state === 'CLOSED') return Promise.reject(new Error('PRACTICE_RESOURCE_BINDING_CLOSED'));
    if (this.state !== 'NEW') return this.state === 'READY' ? Promise.resolve() : Promise.reject(new Error('PRACTICE_DEVICE_UNAVAILABLE'));
    this.state = 'OPENING'; this.notify();
    this.pending = this.timings.measure('resourceBindingOpen', async () => {
      const acquired: PracticeLiveRoot[] = [];
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
          const condition = error instanceof DeviceFailure ? error.code === 'SOURCE_LOST' ? 'UNAVAILABLE' : error.code
            : error instanceof MidiFailure && error.code === 'PERMISSION_DENIED' ? 'PERMISSION_DENIED' : 'UNAVAILABLE';
          this.issue ??= Object.freeze({ resource: opening, phase: 'OPEN', condition });
          this.state = 'FAULTED'; this.notify();
        }
        throw error;
      }
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  borrowRoots(): PracticeDeviceRoots | null {
    return this.state === 'READY' && this.required.every(root => this.health(root) === 'HEALTHY')
      ? this.snapshot().roots : null;
  }
  close(): void {
    if (this.isClosed()) return;
    this.state = 'CLOSED';
    for (const resource of this.required) this.release(resource);
    this.notify(); this.listeners.clear(); this.healthListeners.clear();
  }
  private isClosed(): boolean { return this.state === 'CLOSED'; }
  private release(resource: PracticeLiveRoot): void {
    this.detach.get(resource)?.(); this.detach.delete(resource);
    if (resource !== 'midi') this.roots[resource]?.getTracks().forEach(track => track.stop());
    this.roots[resource] = null;
  }
  private health(resource: PracticeLiveRoot): PracticeDeviceHealth {
    if (resource === 'midi') return this.roots.midi && [...this.roots.midi.inputs.values()].some(input => input.state === 'connected') ? 'HEALTHY' : 'LOST';
    const stream = this.roots[resource];
    const tracks = resource === 'camera' ? stream?.getVideoTracks() : stream?.getAudioTracks();
    if (!tracks?.length || tracks.some(track => track.readyState !== 'live')) return 'LOST';
    return tracks.some(track => track.muted) ? 'INTERRUPTED' : 'HEALTHY';
  }
  private changed(): void {
    if (this.isClosed()) return;
    // A failed acquisition stays failed; a new explicit preparation must create another binding.
    const failedOpen = this.issue?.phase === 'OPEN' && !this.roots[this.issue.resource] ? this.issue : null;
    const resource = this.required.find(resource => this.health(resource) !== 'HEALTHY');
    this.issue = failedOpen ?? (resource ? Object.freeze({ resource, phase: 'RUNTIME',
      condition: this.health(resource) === 'INTERRUPTED' ? 'INTERRUPTED' : 'LOST' }) : null);
    this.state = this.issue ? 'FAULTED' : 'READY'; this.notify();
  }
  private notify(): void {
    const health = this.rootHealth.snapshot();
    for (const listener of [...this.healthListeners]) listener(health);
    for (const listener of this.listeners) listener();
  }
}
