import { vi } from 'vitest';

/** A stalled browser probe; completion is an explicit test-controlled fact. */
export function recordingProbeFixture() {
  class Track extends EventTarget {
    readyState = 'live';
    muted = false;
    readonly clones: Track[] = [];
    constructor(readonly kind: 'audio' | 'video') { super(); }
    stop = vi.fn(() => { this.readyState = 'ended'; });
    clone = vi.fn(() => { const clone = new Track(this.kind); this.clones.push(clone); return clone; });
  }
  class Stream {
    constructor(readonly tracks: Track[]) {}
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  }
  const instances: Recorder[] = [];
  class Recorder {
    static isTypeSupported = () => true;
    state = 'inactive';
    completeOnStop = false;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    ondataavailable: (() => void) | null = null;
    constructor(readonly stream: Stream) { instances.push(this); }
    start = vi.fn(() => { this.state = 'recording'; });
    stop = vi.fn(() => {
      if (!this.completeOnStop) return;
      this.state = 'inactive'; queueMicrotask(() => this.onstop?.());
    });
  }
  vi.stubGlobal('MediaStream', Stream);
  vi.stubGlobal('MediaRecorder', Recorder);
  return { instances, root: (kind: 'audio' | 'video') => {
    const track = new Track(kind);
    return { track, stream: new Stream([track]) as unknown as MediaStream };
  } };
}
