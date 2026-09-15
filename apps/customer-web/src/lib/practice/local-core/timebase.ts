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
  domainId: string;
  ms: number;
  sampleIndex?: number;
};

export type PracticeTimebaseOptions = {
  domainId: string;
  runtimeOriginMs?: number;
  sampleRateHz?: number;
  anchorSampleIndex?: number;
  anchorSessionTimeMs?: number;
};

export class PracticeTimebase {
  readonly domainId: string;
  private readonly runtimeOriginMs: number;
  private readonly sampleRateHz?: number;
  private readonly anchorSampleIndex: number;
  private readonly anchorSessionTimeMs: number;

  constructor(options: PracticeTimebaseOptions | string, sampleRateHz?: number) {
    if (typeof options === 'string') {
      this.domainId = options;
      this.runtimeOriginMs = 0;
      this.sampleRateHz = sampleRateHz;
      this.anchorSampleIndex = 0;
      this.anchorSessionTimeMs = 0;
      return;
    }
    this.domainId = options.domainId;
    this.runtimeOriginMs = options.runtimeOriginMs ?? 0;
    this.sampleRateHz = options.sampleRateHz;
    this.anchorSampleIndex = options.anchorSampleIndex ?? 0;
    this.anchorSessionTimeMs = options.anchorSessionTimeMs ?? 0;
  }

  atSessionMs(ms: number, sampleIndex?: number): SessionTime {
    if (!Number.isFinite(ms)) {
      throw new Error('Session time values must be finite.');
    }
    return sampleIndex === undefined
      ? { domainId: this.domainId, ms }
      : { domainId: this.domainId, ms, sampleIndex };
  }

  runtimeToSessionTime(runtimeMs: number): SessionTime {
    return this.atSessionMs(runtimeMs - this.runtimeOriginMs);
  }

  sampleIndexToSessionTime(sampleIndex: number): SessionTime {
    if (!this.sampleRateHz || this.sampleRateHz <= 0) {
      throw new Error('Sample-index time conversion requires a positive sample rate.');
    }
    return this.atSessionMs(
      this.anchorSessionTimeMs + (sampleIndex - this.anchorSampleIndex) / this.sampleRateHz * 1000,
      sampleIndex
    );
  }

  midiEventToSessionTime(midiEventTimeMs: number): SessionTime {
    return this.runtimeToSessionTime(midiEventTimeMs);
  }

  assertSameSessionTimeDomain(left: SessionTime, right: SessionTime): void {
    if (!Number.isFinite(left.ms) || !Number.isFinite(right.ms)) {
      throw new Error('Session time values must be finite before comparison.');
    }
    if (left.domainId !== right.domainId) {
      throw new Error('Session time values belong to different practice time domains.');
    }
  }
}

export type CaptureTime = {
  captureTime: SessionTime;
};

export type RuntimeVersionIdentity = {
  schemaVersion: number;
  runtimeVersion: string;
  modelVersion?: string;
};
