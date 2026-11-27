import type { LocalMediaAsset } from '@/lib/practice/media/local-media-asset';

export interface RecordingSink {
  readonly byteSize: number;
  append(chunk: Blob): Promise<void>;
  seal(mimeType: string): Promise<LocalMediaAsset>;
  abort(): Promise<void>;
}
export type RecordingSinkFactory = (signal?: AbortSignal) => Promise<RecordingSink>;
