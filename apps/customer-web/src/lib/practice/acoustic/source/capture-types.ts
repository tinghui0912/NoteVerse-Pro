export type CaptureChunk = Readonly<{
  type: 'pcm-chunk'; sequence: number; sourceSampleRateHz: number;
  sourceStartSampleIndex: number; sourceEndSampleIndex: number;
  audioContextStartFrame: number; inputChannelCount: number; captureTimeSeconds: number;
  samples: Float32Array;
}>;
/** The browser source knows only its synchronous PCM consumer and failure cleanup. */
export interface CaptureConsumer {
  receive(chunk: CaptureChunk): void;
  abort(error: unknown): void;
  attachCaptureCleanup(cleanup: () => void): () => void;
}
