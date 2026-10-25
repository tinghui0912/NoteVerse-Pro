import { assertPracticeScoreArtifact, type PracticeScoreArtifact, type TempoSegment } from '@/lib/practice/kernel/artifact';
import { countInContractAt } from '@/lib/practice/kernel/count-in';
import { resolvePracticeScope, type PracticeScope, type ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import type { LocalPracticeCompletionReason } from '@/lib/practice/kernel/session';
import { beatsToMs, PracticeTempoTimeline, type ResolvedPracticeTempoPlan, type ResolvedPracticeTempoSegment } from '@/lib/practice/kernel/tempo';
import { PracticeTimebase, type LocalClock, type SessionTime } from '@/lib/practice/kernel/timebase';

export type PerformanceRuntimeState = 'READY' | 'COUNT_IN' | 'RUNNING' | 'PAUSED' | 'ENDED';

export type PerformanceClockSnapshot = {
  state: PerformanceRuntimeState;
  nowMs: number;
  musicalBeat: number;
  performanceTimeMs: number;
  countInTotalMs: number;
  countInRemainingMs: number;
  countInBeats: number;
  countInPulses: number;
  countInPulse: number;
  scopeCompleted: boolean;
  scopeStartBeat: number;
  scopeTerminalBeat: number;
  completionReason: LocalPracticeCompletionReason | null;
};

export type PerformanceTransportSnapshot = {
  state: PerformanceRuntimeState;
  stateBeforePause: PerformanceRuntimeState;
  scopeStartBeat: number;
  scopeTerminalBeat: number;
  activeElapsedMs: number;
  countInMs: number;
  countInBeats: number;
  countInPulses: number;
};

export type PerformanceClockRuntimeOptions = {
  artifact: PracticeScoreArtifact;
  tempoPlan: ResolvedPracticeTempoPlan;
  scope: PracticeScope;
  clock: LocalClock;
  timebase: PracticeTimebase;
  countInBeats?: number;
};

type PerformanceScope = ResolvedPracticeScope & {
  nominalStartTimeMs: number;
  nominalEndTimeMs: number;
};

export class PerformanceClockRuntime {
  readonly artifact: PracticeScoreArtifact;
  readonly timebase: PracticeTimebase;
  private readonly timeline: PerformanceTimeline;
  private readonly clock: LocalClock;
  private readonly scope: PerformanceScope;
  private readonly countInBeats: number;
  private readonly countInPulses: number;
  private readonly countInMs: number;
  private state: PerformanceRuntimeState = 'READY';
  private stateBeforePause: PerformanceRuntimeState = 'READY';
  private completionReason: LocalPracticeCompletionReason | null = null;
  private activeElapsedMs = 0;
  private currentSegment: ClockSegment | null = null;
  private clockSegments: ClockSegment[] = [];

  constructor(options: PerformanceClockRuntimeOptions) {
    assertPracticeScoreArtifact(options.artifact);
    this.artifact = options.artifact;
    this.clock = options.clock;
    const tempoPlan = options.tempoPlan;
    if (!tempoPlan || !Array.isArray(tempoPlan.segments) || tempoPlan.segments.length === 0) {
      throw new Error('PerformanceClockRuntime requires a valid ResolvedPracticeTempoPlan with segments.');
    }
    this.timeline = new PerformanceTimeline(this.artifact, tempoPlan.segments);
    this.scope = resolvePerformanceScope(this.artifact, this.timeline, options.scope);
    const countIn = countInContractAt(this.artifact, this.scope.startBeat);
    this.countInBeats = options.countInBeats ?? countIn.durationBeats;
    this.countInPulses = countIn.pulses;
    this.countInMs = beatsToMs(this.countInBeats, this.timeline.bpmAtBeat(this.scope.startBeat));
    this.timebase = options.timebase;
  }

  start(): PerformanceClockSnapshot {
    if (this.state !== 'READY') {
      throw new Error('Performance clock can only start from READY.');
    }
    this.completionReason = null;
    this.state = this.countInMs > 0 ? 'COUNT_IN' : 'RUNNING';
    this.activeElapsedMs = 0;
    this.currentSegment = this.startClockSegment(this.state, this.activeElapsedMs);
    return this.snapshot();
  }

  pause(): PerformanceClockSnapshot {
    this.advanceState();
    if (this.state !== 'COUNT_IN' && this.state !== 'RUNNING') {
      throw new Error('Performance clock can only pause while active.');
    }
    this.activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    this.finishCurrentSegment(this.nowSessionMs());
    this.stateBeforePause = this.state;
    this.state = 'PAUSED';
    return this.snapshot();
  }

  resume(): PerformanceClockSnapshot {
    if (this.state !== 'PAUSED') {
      throw new Error('Performance clock can only resume from PAUSED.');
    }
    // Anchor the segment and immediate snapshot to one resume boundary.
    const nowMs = this.nowSessionMs();
    this.state = this.stateBeforePause;
    this.currentSegment = this.startClockSegmentAt(this.state, this.activeElapsedMs, nowMs);
    return this.snapshotAt(nowMs);
  }

  end(reason: LocalPracticeCompletionReason = 'STOPPED_BY_USER'): PerformanceClockSnapshot {
    if (this.state === 'ENDED') {
      return this.snapshot();
    }
    this.activeElapsedMs = this.activeElapsedAt(this.nowSessionMs());
    this.finishCurrentSegment(this.nowSessionMs());
    this.state = 'ENDED';
    this.completionReason = reason;
    return this.snapshot();
  }

  snapshot(): PerformanceClockSnapshot {
    return this.snapshotAt(this.nowSessionMs());
  }

  private snapshotAt(nowMs: number): PerformanceClockSnapshot {
    const activeElapsedMs = this.advanceState(nowMs);
    const performanceTimeMs = this.performanceElapsedMs(activeElapsedMs);
    const countInTotalMs = this.countInMs;
    const countInRemainingMs = Math.max(0, this.countInMs - activeElapsedMs);
    const countInPulse = this.countInPulses > 0 && countInTotalMs > 0 && this.state === 'COUNT_IN'
      ? Math.min(
          this.countInPulses,
          Math.max(1, Math.floor(((countInTotalMs - countInRemainingMs) / countInTotalMs) * this.countInPulses) + 1)
        )
      : 1;
    return {
      state: this.state,
      nowMs,
      musicalBeat: this.musicalBeat(performanceTimeMs),
      performanceTimeMs,
      countInTotalMs,
      countInRemainingMs,
      countInBeats: this.countInBeats,
      countInPulses: this.countInPulses,
      countInPulse,
      scopeCompleted: this.completionReason === 'SCOPE_COMPLETED',
      scopeStartBeat: this.scope.startBeat,
      scopeTerminalBeat: this.scope.terminalBeat,
      completionReason: this.completionReason,
    };
  }

  performanceTimeAtCapture(captureTimeMs: number): number | null {
    const activeElapsedMs = this.activeElapsedForCapture(captureTimeMs);
    if (activeElapsedMs === null) {
      return null;
    }
    if (
      activeElapsedMs < this.countInMs ||
      activeElapsedMs > this.countInMs + this.scopeDurationMs()
    ) {
      return null;
    }
    return this.performanceElapsedMs(activeElapsedMs);
  }

  completionCaptureTime(): SessionTime {
    const targetActiveElapsedMs = Math.min(
      this.activeElapsedMs,
      this.countInMs + this.scopeDurationMs()
    );
    return this.timebase.atSessionMs(this.sessionMsForActiveElapsed(targetActiveElapsedMs));
  }

  /** Reads transport coordinates without advancing lifecycle transitions. */
  transportSnapshot(): PerformanceTransportSnapshot {
    return {
      state: this.state,
      stateBeforePause: this.stateBeforePause,
      scopeStartBeat: this.scope.startBeat,
      scopeTerminalBeat: this.scope.terminalBeat,
      activeElapsedMs: this.activeElapsedAt(this.nowSessionMs()),
      countInMs: this.countInMs,
      countInBeats: this.countInBeats,
      countInPulses: this.countInPulses,
    };
  }

  get terminationReason(): LocalPracticeCompletionReason | null {
    return this.completionReason;
  }

  scopeDurationMs(): number {
    return Math.max(0, this.scope.nominalEndTimeMs - this.scope.nominalStartTimeMs);
  }

  private advanceState(nowMs = this.nowSessionMs()): number {
    if (this.state === 'READY') {
      return 0;
    }
    const activeElapsedMs = this.activeElapsedAt(nowMs);
    if (this.state === 'PAUSED' || this.state === 'ENDED') {
      return activeElapsedMs;
    }
    if (this.state === 'COUNT_IN' && activeElapsedMs >= this.countInMs) {
      const boundarySessionMs = this.sessionMsForActiveElapsed(this.countInMs, nowMs);
      this.finishCurrentSegment(boundarySessionMs);
      this.state = 'RUNNING';
      this.currentSegment = this.startClockSegmentAt('RUNNING', this.countInMs, boundarySessionMs);
    }
    const terminalActiveElapsedMs = this.countInMs + this.scopeDurationMs();
    if (this.state === 'RUNNING' && activeElapsedMs >= terminalActiveElapsedMs) {
      const boundarySessionMs = this.sessionMsForActiveElapsed(terminalActiveElapsedMs, nowMs);
      this.activeElapsedMs = terminalActiveElapsedMs;
      this.finishCurrentSegment(boundarySessionMs);
      this.state = 'ENDED';
      this.completionReason = 'SCOPE_COMPLETED';
    } else if (activeElapsedMs < this.countInMs) {
      this.state = 'COUNT_IN';
    } else {
      this.state = 'RUNNING';
    }
    return activeElapsedMs;
  }

  private activeElapsedAt(nowMs: number): number {
    if (!this.currentSegment || this.state === 'PAUSED' || this.state === 'ENDED') {
      return this.activeElapsedMs;
    }
    return Math.max(0, this.activeElapsedAtSessionTime(this.currentSegment, nowMs));
  }

  private activeElapsedForCapture(captureTimeMs: number): number | null {
    for (const segment of this.clockSegments) {
      const end = segment.clockEndMs ?? (
        this.currentSegment === segment ? this.nowSessionMs() : segment.clockStartMs
      );
      if (segment.clockStartMs <= captureTimeMs && captureTimeMs <= end) {
        return Math.max(0, this.activeElapsedAtSessionTime(segment, captureTimeMs));
      }
    }
    if (this.currentSegment
      && this.currentSegment.clockStartMs <= captureTimeMs
      && captureTimeMs <= this.nowSessionMs()) {
      return Math.max(0, this.activeElapsedAtSessionTime(this.currentSegment, captureTimeMs));
    }
    return null;
  }

  private sessionMsForActiveElapsed(activeElapsedMs: number, nowMs?: number): number {
    for (const segment of this.clockSegments) {
      const segmentEndActiveElapsed = segment.clockEndMs === undefined
        ? this.activeElapsedAt(nowMs ?? this.nowSessionMs())
        : this.activeElapsedAtSessionTime(segment, segment.clockEndMs);
      if (
        segment.activeElapsedStartMs <= activeElapsedMs &&
        activeElapsedMs <= segmentEndActiveElapsed
      ) {
        return this.sessionTimeAtActiveElapsed(segment, activeElapsedMs);
      }
    }
    return nowMs ?? this.nowSessionMs();
  }

  // Subtract in one time domain before adding the other domain's anchor. In
  // particular, a zero segment delta must preserve pause/resume identity exactly.
  private activeElapsedAtSessionTime(segment: ClockSegment, sessionTimeMs: number): number {
    return segment.activeElapsedStartMs + (sessionTimeMs - segment.clockStartMs);
  }

  private sessionTimeAtActiveElapsed(segment: ClockSegment, activeElapsedMs: number): number {
    return segment.clockStartMs + (activeElapsedMs - segment.activeElapsedStartMs);
  }

  private startClockSegment(state: PerformanceRuntimeState, activeElapsedStartMs: number): ClockSegment {
    return this.startClockSegmentAt(state, activeElapsedStartMs, this.nowSessionMs());
  }

  private startClockSegmentAt(
    state: PerformanceRuntimeState,
    activeElapsedStartMs: number,
    clockStartMs: number
  ): ClockSegment {
    const segment = {
      state,
      clockStartMs,
      activeElapsedStartMs,
    };
    this.clockSegments.push(segment);
    return segment;
  }

  private finishCurrentSegment(clockEndMs: number): void {
    if (this.currentSegment) {
      this.currentSegment.clockEndMs = clockEndMs;
      this.currentSegment = null;
    }
  }

  private performanceElapsedMs(activeElapsedMs: number): number {
    return Math.min(
      Math.max(0, activeElapsedMs - this.countInMs),
      this.scopeDurationMs()
    );
  }

  private musicalBeat(performanceTimeMs: number): number {
    if (performanceTimeMs >= this.scopeDurationMs()) {
      return this.scope.terminalBeat;
    }
    return this.timeline.timeMsToBeat(this.scope.nominalStartTimeMs + performanceTimeMs);
  }

  private nowSessionMs(): number {
    return this.timebase.runtimeToSessionTime(this.clock.nowMs()).ms;
  }
}

type ClockSegment = {
  state: PerformanceRuntimeState;
  clockStartMs: number;
  clockEndMs?: number;
  activeElapsedStartMs: number;
};

export class PerformanceTimeline extends PracticeTempoTimeline {
  constructor(artifact: PracticeScoreArtifact, tempoSegments: readonly TempoSegment[]) {
    super(
      {
        selection: { mode: 'SCORE' },
        segments: tempoSegments.map((s) => ({
          startBeat: s.startBeat,
          bpm: s.bpm,
          source: 'source' in s ? (s as ResolvedPracticeTempoSegment).source : 'MUSICXML',
        })),
      },
      artifact.scoreEndBeat
    );
  }
}

function resolvePerformanceScope(
  artifact: PracticeScoreArtifact,
  timeline: PerformanceTimeline,
  scope: PracticeScope
): PerformanceScope {
  const resolved = resolvePracticeScope(artifact, scope);
  return {
    ...resolved,
    nominalStartTimeMs: timeline.beatToTimeMs(resolved.startBeat),
    nominalEndTimeMs: timeline.beatToTimeMs(resolved.terminalBeat),
  };
}
