import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetronomeController } from './metronome-controller';
import type { MeterSegment } from '../local-core/artifact';
import type { ResolvedPracticeTempoPlan } from '../local-core/practice-tempo';

interface ScheduledClick {
  freq: number;
  gain: number;
  time: number;
}

function createMockAudioContext() {
  let currentTime = 0;
  const scheduledClicks: ScheduledClick[] = [];

  const ctx = {
    get currentTime() {
      return currentTime;
    },
    advanceTime(seconds: number) {
      currentTime += seconds;
    },
    state: 'running',
    destination: {},
    createOscillator() {
      let freq = 0;
      let startTime = 0;
      return {
        type: 'sine',
        frequency: {
          setValueAtTime(val: number) {
            freq = val;
          },
        },
        connect(target: { gainValue?: number }) {
          scheduledClicks.push({
            freq,
            gain: target.gainValue ?? 0,
            time: startTime,
          });
        },
        start(time: number) {
          startTime = time;
        },
        stop() {},
      };
    },
    createGain() {
      let gainVal = 0;
      return {
        get gainValue() {
          return gainVal;
        },
        gain: {
          setValueAtTime(val: number) {
            gainVal = val;
          },
          exponentialRampToValueAtTime() {},
        },
        connect() {},
      };
    },
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { ctx: ctx as unknown as AudioContext & { advanceTime: (s: number) => void }, scheduledClicks };
}

describe('MetronomeController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const tempoPlan120: ResolvedPracticeTempoPlan = {
    source: 'PRODUCT_DEFAULT',
    segments: [{ startBeat: 0, bpm: 120 }], // 0.5s per beat
  };

  const meter4_4: MeterSegment[] = [
    {
      startBeat: 0,
      numerator: 4,
      denominator: 4,
      measureDurationBeats: 4,
      countInPulses: 4,
    },
  ];

  it('does not schedule any audio events when disabled', () => {
    const { ctx, scheduledClicks } = createMockAudioContext();
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      enabled: false,
      audioContext: ctx,
    });

    metronome.start(0);
    ctx.advanceTime(0.2);
    vi.advanceTimersByTime(200);

    expect(scheduledClicks).toHaveLength(0);
    metronome.stop();
  });

  it('schedules clicks and accents measure downbeats when enabled', () => {
    const { ctx, scheduledClicks } = createMockAudioContext();
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      enabled: true,
      audioContext: ctx,
    });

    metronome.start(0);
    // Initial tick schedules beat 0 (at 0.05s)
    expect(scheduledClicks.length).toBeGreaterThanOrEqual(1);
    expect(scheduledClicks[0].freq).toBe(1200); // Accent on downbeat (beat 0)
    expect(scheduledClicks[0].gain).toBe(1.0);

    // Advance time past beat 1 (0.55s) and beat 2 (1.05s)
    ctx.advanceTime(1.2);
    vi.advanceTimersByTime(1200);

    // Beat 1 and 2 should have regular frequency 800 Hz and gain 0.5
    const regularClicks = scheduledClicks.filter((c) => c.freq === 800);
    expect(regularClicks.length).toBeGreaterThanOrEqual(2);
    expect(regularClicks[0].gain).toBe(0.5);

    metronome.stop();
  });

  it('correctly accents downbeats in 3/4 meter across measures', () => {
    const meter3_4: MeterSegment[] = [
      {
        startBeat: 0,
        numerator: 3,
        denominator: 4,
        measureDurationBeats: 3,
        countInPulses: 3,
      },
    ];
    const { ctx, scheduledClicks } = createMockAudioContext();
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter3_4,
      enabled: true,
      audioContext: ctx,
    });

    metronome.start(0);
    // Advance enough time to cover 4 measures (12 beats = 6 seconds at 120 bpm)
    for (let i = 0; i < 12; i++) {
      ctx.advanceTime(0.5);
      vi.advanceTimersByTime(500);
    }

    const accents = scheduledClicks.filter((c) => c.freq === 1200);
    // Beats 0, 3, 6, 9, 12 should be accented
    expect(accents.length).toBeGreaterThanOrEqual(4);
    metronome.stop();
  });

  it('dynamically toggles enabled state in real time', () => {
    const { ctx, scheduledClicks } = createMockAudioContext();
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      enabled: false,
      audioContext: ctx,
    });

    metronome.start(0);
    ctx.advanceTime(1.0);
    vi.advanceTimersByTime(1000);
    expect(scheduledClicks).toHaveLength(0);

    // Turn ON while running
    metronome.setEnabled(true);
    ctx.advanceTime(0.6);
    vi.advanceTimersByTime(600);
    expect(scheduledClicks.length).toBeGreaterThan(0);

    // Turn OFF while running
    const countBefore = scheduledClicks.length;
    metronome.setEnabled(false);
    ctx.advanceTime(1.0);
    vi.advanceTimersByTime(1000);
    expect(scheduledClicks.length).toBe(countBefore);

    metronome.stop();
  });

  it('pauses and resumes without phase drift', () => {
    const { ctx, scheduledClicks } = createMockAudioContext();
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      enabled: true,
      audioContext: ctx,
    });

    metronome.start(0);
    ctx.advanceTime(0.5);
    vi.advanceTimersByTime(500);
    metronome.pause();

    const countAtPause = scheduledClicks.length;
    ctx.advanceTime(5.0);
    vi.advanceTimersByTime(5000);
    // No new clicks scheduled while paused
    expect(scheduledClicks.length).toBe(countAtPause);

    // Resume from beat 1.5
    metronome.resume(1.5);
    ctx.advanceTime(0.5);
    vi.advanceTimersByTime(500);
    expect(scheduledClicks.length).toBeGreaterThan(countAtPause);

    metronome.stop();
  });

  it('gracefully handles AudioContext errors without throwing', () => {
    const errorCtx = {
      currentTime: 0,
      state: 'running',
      destination: {},
      createOscillator() {
        throw new Error('Web Audio hardware failure');
      },
      createGain() {
        throw new Error('Web Audio hardware failure');
      },
    } as unknown as AudioContext;

    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      enabled: true,
      audioContext: errorCtx,
    });

    expect(() => {
      metronome.start(0);
      vi.advanceTimersByTime(200);
      metronome.stop();
    }).not.toThrow();
  });
});
