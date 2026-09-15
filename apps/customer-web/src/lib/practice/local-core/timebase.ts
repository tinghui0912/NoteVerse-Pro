export type LocalClock = {
  nowMs(): number;
};

export type DurableClock = {
  nowEpochMs(): number;
};

export class ManualClock implements LocalClock {
  private currentMs: number;

  constructor(initialMs = 0) {
    this.currentMs = initialMs;
  }

  nowMs(): number {
    return this.currentMs;
  }

  set(ms: number): void {
    this.currentMs = ms;
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}

export class ManualDurableClock implements DurableClock {
  private currentEpochMs: number;

  constructor(initialEpochMs = 0) {
    this.currentEpochMs = initialEpochMs;
  }

  nowEpochMs(): number {
    return this.currentEpochMs;
  }

  set(epochMs: number): void {
    this.currentEpochMs = epochMs;
  }

  advance(ms: number): void {
    this.currentEpochMs += ms;
  }
}

export type SessionTime = {
  sessionTimeMs: number;
  sampleIndex?: number;
};

export class PracticeTimebase {
  constructor(
    private readonly originRuntimeMs: number,
    private readonly sampleRate?: number,
  ) {}

  runtimeToSessionTime(runtimeMs: number): SessionTime {
    return { sessionTimeMs: Math.max(0, runtimeMs - this.originRuntimeMs) };
  }

  sampleIndexToSessionTime(sampleIndex: number): SessionTime {
    if (!this.sampleRate || this.sampleRate <= 0) {
      throw new Error('Sample-index time conversion requires a positive sample rate.');
    }
    return {
      sessionTimeMs: sampleIndex / this.sampleRate * 1000,
      sampleIndex,
    };
  }

  assertSameSessionTimeDomain(left: SessionTime, right: SessionTime): void {
    if (!Number.isFinite(left.sessionTimeMs) || !Number.isFinite(right.sessionTimeMs)) {
      throw new Error('Session time values must be finite before comparison.');
    }
  }
}

export type CaptureTime = {
  captureTimeMs: number;
  sampleIndex?: number;
};

export type RuntimeVersionIdentity = {
  schemaVersion: number;
  runtimeVersion: string;
  modelVersion?: string;
};
