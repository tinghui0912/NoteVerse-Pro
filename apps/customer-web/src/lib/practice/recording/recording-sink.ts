/** Each handle owns one reference; release is idempotent for that handle. */
export interface RecordingMediaResource {
  retain(): RecordingMediaResource;
  release(): Promise<void>;
}

export type SealedRecordingMedia = Readonly<{
  blob: Blob;
  byteSize: number;
  resource: RecordingMediaResource;
}>;

export interface RecordingSink {
  readonly byteSize: number;
  append(chunk: Blob): Promise<void>;
  seal(mimeType: string): Promise<SealedRecordingMedia>;
  abort(): Promise<void>;
}

export type RecordingSinkFactory = (signal?: AbortSignal) => Promise<RecordingSink>;
