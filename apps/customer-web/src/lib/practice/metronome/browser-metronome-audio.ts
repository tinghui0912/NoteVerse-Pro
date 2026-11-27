import { AudioContextFailure } from '@/lib/practice/failure/causal-failure';
import { resumePracticeAudioContext } from '@/lib/practice/failure/browser-failures';
import type { MetronomeAudioPort } from './metronome-audio-port';

type AudioOwnership = Readonly<{ kind: 'BORROWED'; context: AudioContext }> | Readonly<{ kind: 'OWNED' }>;
type AudioWindow = Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

/** Web Audio ownership is local to this adapter. Audio faults silence only the optional aid. */
export function createBrowserMetronomeAudio(ownership: AudioOwnership): MetronomeAudioPort {
  let context: AudioContext | null = ownership.kind === 'BORROWED' ? ownership.context : null;
  let disposed = false, unavailable = false;
  return Object.freeze({
    activate() {
      if (disposed || unavailable) return;
      try {
        if (!context) {
          const audioWindow = typeof window !== 'undefined' ? window as AudioWindow : null;
          const Constructor = audioWindow?.AudioContext || audioWindow?.webkitAudioContext;
          if (!Constructor) throw new AudioContextFailure('UNAVAILABLE');
          try { context = new Constructor(); } catch (cause) { throw new AudioContextFailure('UNAVAILABLE', { cause }); }
        }
        if (context.state === 'suspended') void resumePracticeAudioContext(context).catch(() => { unavailable = true; });
      } catch { unavailable = true; }
    },
    nowMs: () => disposed || unavailable ? 0 : (context?.currentTime ?? 0) * 1000,
    scheduleClick({ atMs, accent }) {
      if (disposed || unavailable || !context || context.state !== 'running') return;
      try {
        const time = atMs / 1000, frequency = accent ? 1200 : 800, decay = accent ? 0.03 : 0.02;
        const oscillator = context.createOscillator(), gain = context.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, time);
        gain.gain.setValueAtTime(accent ? 1.0 : 0.5, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(time); oscillator.stop(time + decay + 0.01);
      } catch { /* Individual click faults are nonfatal. */ }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const released = context; context = null;
      if (ownership.kind === 'OWNED' && released) {
        try { return released.close().catch(() => {}); } catch { /* Optional audio teardown is nonfatal. */ }
      }
    },
  });
}
