import type { LocalMediaAsset } from "@/lib/practice/media/local-media-asset";
type PerformanceReplayTimebase = {
  version: 1;
  speedRatio: number;
};

type ReplaySource =
  | { media: LocalMediaAsset; url?: never }
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
