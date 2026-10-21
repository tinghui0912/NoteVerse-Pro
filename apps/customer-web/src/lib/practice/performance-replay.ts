type PerformanceReplayTimebase = {
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
