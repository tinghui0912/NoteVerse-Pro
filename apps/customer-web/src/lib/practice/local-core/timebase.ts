export type LocalClock = {
  nowMs(): number;
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

export type CaptureTime = {
  captureTimeMs: number;
  sampleIndex?: number;
};

export type RuntimeVersionIdentity = {
  schemaVersion: number;
  runtimeVersion: string;
  modelVersion?: string;
};
