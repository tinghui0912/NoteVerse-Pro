import type { OwnedMediaHandle } from './owned-media';

export interface RecordingSink {
  readonly byteSize: number;
  append(chunk: Blob): Promise<void>;
  seal(mimeType: string): Promise<OwnedMediaHandle>;
  abort(): Promise<void>;
}
export type RecordingSinkFactory = (signal?: AbortSignal) => Promise<RecordingSink>;
