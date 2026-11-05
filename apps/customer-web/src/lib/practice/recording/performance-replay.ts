import type { OwnedMediaHandle } from "./owned-media";
type PerformanceReplayTimebase = {
  version: 1;
  speedRatio: number;
};

type ReplaySource =
  | { media: OwnedMediaHandle; url?: never }
  | { url: string; media?: never };

export type PlayablePerformanceReplay =
  | (ReplaySource & {
      kind: "AUDIO_RECORDING";
      contentType: string;
      byteSize?: number;
      durationMs: number;
      timebase?: PerformanceReplayTimebase;
    })
  | (ReplaySource & {
      kind: "VIDEO_RECORDING";
      contentType: string;
      byteSize?: number;
      durationMs: number;
      timebase?: PerformanceReplayTimebase;
    });
