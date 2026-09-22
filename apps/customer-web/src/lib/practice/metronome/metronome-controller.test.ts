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
    selection: { mode: 'SCORE' },
    segments: [{ startBeat: 0, bpm: 120, source: 'PRODUCT_DEFAULT' }], // 0.5s per beat
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

  it('rejects invalid or empty tempoPlan with domain error', () => {
    expect(() => {
      new MetronomeController({
        tempoPlan: { selection: { mode: 'SCORE' }, segments: [] },
      });
    }).toThrowError(/MetronomeController requires a valid ResolvedPracticeTempoPlan with segments/);
  });

  it('operates in STEP mode maintaining steady pulse anchored to targetOnsetBeat', () => {
    const { ctx, scheduledClicks } = createMockAudioContext();
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      mode: 'STEP',
      enabled: true,
      audioContext: ctx,
    });

    metronome.start(4.0); // target onsetBeat = 4.0 (measure downbeat)

    // Initial click scheduled at 0.05s, downbeat accent
    expect(scheduledClicks.length).toBeGreaterThanOrEqual(1);
    expect(scheduledClicks[0].freq).toBe(1200); // downbeat accent

    // Advance 1.2 seconds: should get 2 regular clicks (beats 5, 6)
    ctx.advanceTime(1.2);
    vi.advanceTimersByTime(1200);

    const regular = scheduledClicks.filter((c) => c.freq === 800);
    expect(regular.length).toBeGreaterThanOrEqual(2);

    // Now update step target to beat 5.0 (which is not a downbeat in 4/4)
    metronome.setStepContext(5.0);
    const clickCountBefore = scheduledClicks.length;

    ctx.advanceTime(0.6);
    vi.advanceTimersByTime(600);

    expect(scheduledClicks.length).toBeGreaterThan(clickCountBefore);
    // At beat 5.0, virtual beat starts at 5.0 which is not downbeat
    const newClicks = scheduledClicks.slice(clickCountBefore);
    expect(newClicks[0].freq).toBe(800);

    metronome.stop();
  });

  it('schedules count-in pulses before running in CONTINUOUS mode', () => {
    const { ctx, scheduledClicks } = createMockAudioContext();
    const scheduledPulses: unknown[] = [];
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      mode: 'CONTINUOUS',
      countInPulses: 4,
      countInBeats: 4,
      enabled: true,
      audioContext: ctx,
      onScheduledPulse: (pulse) => {
        scheduledPulses.push(pulse);
      },
    });

    metronome.start(0, { countIn: true, countInPulses: 4, countInBeats: 4 });

    // In 120 bpm, 4 beats = 2.0s
    // Advance through count-in (2.0s) + 1 beat of running (0.5s)
    for (let i = 0; i < 6; i++) {
      ctx.advanceTime(0.5);
      vi.advanceTimersByTime(500);
    }

    // Total clicks: 4 count-in + running pulses
    expect(scheduledClicks.length).toBeGreaterThanOrEqual(5);
    expect(scheduledPulses.length).toBeGreaterThanOrEqual(5);

    metronome.stop();
  });

  it('resumes CONTINUOUS mode from exact count-in remaining phase', () => {
    const { ctx } = createMockAudioContext();
    const scheduledPulses: Array<{ isCountIn?: boolean; pulseIndexInMeasure: number; isDownbeat: boolean; scoreBeat: number }> = [];

    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      mode: 'CONTINUOUS',
      enabled: true,
      audioContext: ctx,
      onScheduledPulse: (pulse) => {
        scheduledPulses.push({
          isCountIn: pulse.isCountIn,
          pulseIndexInMeasure: pulse.pulseIndexInMeasure,
          isDownbeat: pulse.isDownbeat,
          scoreBeat: pulse.scoreBeat,
        });
      },
    });

    // Resume from paused count-in with 2 pulses remaining (pulses 3 & 4)
    metronome.resume({
      state: 'COUNT_IN',
      scopeStartBeat: 0,
      countInTotalMs: 2000,
      countInRemainingMs: 1000,
      countInPulses: 4,
      countInPulse: 3,
    });

    // Advance 2 seconds
    for (let i = 0; i < 4; i++) {
      ctx.advanceTime(0.5);
      vi.advanceTimersByTime(500);
    }

    // Should have remaining 2 count-in pulses, then running beat 0.0
    const countInPulses = scheduledPulses.filter((p) => p.isCountIn);
    expect(countInPulses).toHaveLength(2);
    expect(countInPulses[0].pulseIndexInMeasure).toBe(2);
    expect(countInPulses[1].pulseIndexInMeasure).toBe(3);

    const runningPulses = scheduledPulses.filter((p) => !p.isCountIn);
    expect(runningPulses.length).toBeGreaterThanOrEqual(1);
    expect(runningPulses[0].scoreBeat).toBe(0.0);
    expect(runningPulses[0].isDownbeat).toBe(true);

    metronome.stop();
  });

  it('does not consume continuous pulses when equivalent tempo plans are applied every render', () => {
    const { ctx } = createMockAudioContext();
    const scheduledPulses: Array<{ isCountIn?: boolean; scoreBeat: number; audioTime: number }> = [];
    const metronome = new MetronomeController({
      tempoPlan: tempoPlan120,
      meterSegments: meter4_4,
      mode: 'CONTINUOUS',
      countInPulses: 4,
      countInBeats: 4,
      scopeStartBeat: 0,
      scopeEndBeat: 32,
      enabled: true,
      audioContext: ctx,
      onScheduledPulse: (pulse, audioTime) => {
        scheduledPulses.push({
          isCountIn: pulse.isCountIn,
          scoreBeat: pulse.scoreBeat,
          audioTime,
        });
      },
    });

    const cloneTempoPlan = (): ResolvedPracticeTempoPlan => ({
      selection: { mode: 'SCORE' },
      segments: tempoPlan120.segments.map((segment) => ({ ...segment })),
    });

    metronome.start(0, { countIn: true, countInPulses: 4, countInBeats: 4 });

    for (let i = 0; i < 125; i += 1) {
      metronome.setTempoPlan(cloneTempoPlan());
      ctx.advanceTime(0.016);
      vi.advanceTimersByTime(16);
    }

    for (let i = 0; i < 75; i += 1) {
      metronome.setTempoPlan(cloneTempoPlan());
      ctx.advanceTime(0.016);
      vi.advanceTimersByTime(16);
    }

    const countInPulses = scheduledPulses.filter((pulse) => pulse.isCountIn);
    const runningPulses = scheduledPulses.filter((pulse) => !pulse.isCountIn);

    expect(countInPulses.map((pulse) => pulse.audioTime)).toEqual([
      0.05,
      0.55,
      1.05,
      1.55,
    ]);
    expect(runningPulses.length).toBeGreaterThanOrEqual(2);
    expect(runningPulses.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < runningPulses.length; i += 1) {
      expect(runningPulses[i].audioTime - runningPulses[i - 1].audioTime).toBeGreaterThanOrEqual(0.45);
    }
    expect(metronome.planningCursor?.phase).toBe('RUNNING');
    if (metronome.planningCursor?.phase === 'RUNNING') {
      expect(metronome.planningCursor.currentBeat).toBeLessThan(10);
    }

    metronome.stop();
  });
});
