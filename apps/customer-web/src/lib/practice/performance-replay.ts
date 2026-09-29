export type PerformanceReplayTimebase = {
  version: 1;
  speedRatio: number;
};

export type PlayablePerformanceReplay =
  | {
      kind: 'AUDIO_RECORDING';
      blob?: Blob;
      url?: string;
      contentType: string;
      byteSize?: number;
      durationMs: number;
      timebase?: PerformanceReplayTimebase;
    }
  | {
      kind: 'VIDEO_RECORDING';
      blob?: Blob;
      url?: string;
      contentType: string;
      byteSize?: number;
      durationMs: number;
      timebase?: PerformanceReplayTimebase;
    };

export function createPerformanceReplayTimebase(
  speedRatio: number
): PerformanceReplayTimebase {
  return {
    version: 1,
    speedRatio: Number.isFinite(speedRatio) && speedRatio > 0 ? speedRatio : 1,
  };
}
