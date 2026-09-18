import { describe, expect, it, vi } from 'vitest';

import {
  computeSha256Hex,
  createModelAssetStore,
  ModelAssetStore,
  validateModelAssetDescriptor,
} from './model-asset-store';
import {
  type ModelAssetDescriptor,
  ModelAssetDownloadError,
  ModelAssetIntegrityError,
  ModelAssetStorageError,
  ModelAssetStorageUnavailableError,
} from './types';
import { byteDanceManifestToModelAssetDescriptor, createOpfsByteDanceModelLoader } from './bytedance-model-loader';
import { defaultByteDanceModelManifest } from '../practice/acoustic-inference/bytedance-contract';

class MemoryWritableStream implements FileSystemWritableFileStream {
  readonly locked = false;
  private buffer: number[] = [];
  private closed = false;
  private aborted = false;

  constructor(
    private readonly onCommit: (bytes: Uint8Array) => void,
    private readonly beforeWrite?: (data: unknown) => void | Promise<void>,
    private readonly beforeClose?: () => void | Promise<void>
  ) {}

  async write(data: unknown): Promise<void> {
    if (this.closed || this.aborted) {
      throw new Error('Cannot write to closed stream');
    }
    if (this.beforeWrite) {
      await this.beforeWrite(data);
    }
    if (typeof data === 'string') {
      const bytes = new TextEncoder().encode(data);
      this.buffer.push(...bytes);
    } else if (data instanceof Uint8Array) {
      this.buffer.push(...data);
    } else if (ArrayBuffer.isView(data)) {
      this.buffer.push(...new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    } else if (data instanceof ArrayBuffer) {
      this.buffer.push(...new Uint8Array(data));
    }
  }

  async seek(): Promise<void> {}
  async truncate(): Promise<void> {
    this.buffer = [];
  }

  async close(): Promise<void> {
    if (this.closed || this.aborted) return;
    if (this.beforeClose) {
      await this.beforeClose();
    }
    this.closed = true;
    this.onCommit(new Uint8Array(this.buffer));
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }

  getWriter(): WritableStreamDefaultWriter<unknown> {
    throw new Error('Not implemented');
  }
}

class MemoryFileHandle {
  readonly kind = 'file' as const;
  private data: Uint8Array;
  beforeWrite?: (data: unknown) => void | Promise<void>;
  beforeClose?: () => void | Promise<void>;
  onCreateWritable?: () => Promise<FileSystemWritableFileStream> | FileSystemWritableFileStream;

  constructor(
    readonly name: string,
    initialData: Uint8Array = new Uint8Array(0)
  ) {
    this.data = initialData;
  }

  setData(data: Uint8Array): void {
    this.data = data;
  }

  getData(): Uint8Array {
    return this.data;
  }

  async getFile(): Promise<File> {
    return new File([this.data as BlobPart], this.name);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    if (this.onCreateWritable) {
      return this.onCreateWritable();
    }
    return new MemoryWritableStream(
      (committed) => {
        this.data = committed;
      },
      this.beforeWrite,
      this.beforeClose
    );
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly entriesMap = new Map<string, MemoryFileHandle | MemoryDirectoryHandle>();
  onGetFileHandle?: (name: string, options?: { create?: boolean }) => MemoryFileHandle | undefined;

  constructor(readonly name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
    if (this.onGetFileHandle) {
      const intercepted = this.onGetFileHandle(name, options);
      if (intercepted) return intercepted;
    }
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind !== 'file') {
        throw new Error(`Entry ${name} is a directory, not a file.`);
      }
      return existing;
    }
    if (options?.create) {
      const created = new MemoryFileHandle(name);
      this.entriesMap.set(name, created);
      return created;
    }
    throw new Error(`File not found: ${name}`);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectoryHandle> {
    const existing = this.entriesMap.get(name);
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new Error(`Entry ${name} is a file, not a directory.`);
      }
      existing.onGetFileHandle = this.onGetFileHandle;
      return existing;
    }
    if (options?.create) {
      const created = new MemoryDirectoryHandle(name);
      created.onGetFileHandle = this.onGetFileHandle;
      this.entriesMap.set(name, created);
      return created;
    }
    throw new Error(`Directory not found: ${name}`);
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const existing = this.entriesMap.get(name);
    if (!existing) {
      throw new Error(`Entry not found: ${name}`);
    }
    if (existing.kind === 'directory' && !options?.recursive) {
      throw new Error(`Cannot remove directory without recursive option`);
    }
    this.entriesMap.delete(name);
  }

  async *entries(): AsyncIterable<[string, MemoryFileHandle | MemoryDirectoryHandle]> {
    for (const entry of this.entriesMap.entries()) {
      yield entry;
    }
  }

  async *values(): AsyncIterable<MemoryFileHandle | MemoryDirectoryHandle> {
    for (const val of this.entriesMap.values()) {
      yield val;
    }
  }

  async *keys(): AsyncIterable<string> {
    for (const key of this.entriesMap.keys()) {
      yield key;
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<[string, MemoryFileHandle | MemoryDirectoryHandle]> {
    yield* this.entries();
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }

  async resolve(_possibleDescendant: unknown): Promise<string[] | null> {
    return null;
  }

  asDirectoryHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

async function makeTestAsset(content: string, assetId = 'test-model', assetVersion = 'v1.0.0') {
  const bytes = new TextEncoder().encode(content);
  const sha256 = await computeSha256Hex(bytes);
  const descriptor: ModelAssetDescriptor = {
    schemaVersion: 1,
    assetId,
    assetVersion,
    url: `https://cdn.example.com/models/${sha256}.bin?token=secret123`,
    expectedByteSize: bytes.byteLength,
    sha256,
    mediaType: 'application/octet-stream',
  };
  return { bytes, sha256, descriptor };
}

describe('ModelAssetDescriptor validation', () => {
  it('accepts a valid descriptor', async () => {
    const { descriptor } = await makeTestAsset('valid content');
    expect(() => validateModelAssetDescriptor(descriptor)).not.toThrow();
  });

  it('rejects invalid schema version', async () => {
    const { descriptor } = await makeTestAsset('valid');
    const invalid = { ...descriptor, schemaVersion: 2 as unknown as 1 };
    expect(() => validateModelAssetDescriptor(invalid)).toThrow(/schema version/i);
  });

  it('rejects missing or empty assetId', async () => {
    const { descriptor } = await makeTestAsset('valid');
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: '' })).toThrow(/assetId/i);
  });

  it('assetId validation rejects slash, uppercase, and unsafe values while accepting safe identifiers', async () => {
    const { descriptor } = await makeTestAsset('valid');
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: 'test/model' })).toThrow(/assetId/i);
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: '../escape' })).toThrow(/assetId/i);
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: 'MODEL_UPPER' })).toThrow(/assetId/i);
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: '-leading-dash' })).toThrow(/assetId/i);
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: 'bad@char' })).toThrow(/assetId/i);

    // Valid identifiers
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: 'bytedance-piano-transcription-note-model' })).not.toThrow();
    expect(() => validateModelAssetDescriptor({ ...descriptor, assetId: 'model.v1_sub-part' })).not.toThrow();
  });

  it('rejects non-positive expectedByteSize', async () => {
    const { descriptor } = await makeTestAsset('valid');
    expect(() => validateModelAssetDescriptor({ ...descriptor, expectedByteSize: 0 })).toThrow(/expectedByteSize/i);
    expect(() => validateModelAssetDescriptor({ ...descriptor, expectedByteSize: -1 })).toThrow(/expectedByteSize/i);
  });

  it('rejects invalid sha256 length or characters', async () => {
    const { descriptor } = await makeTestAsset('valid');
    expect(() => validateModelAssetDescriptor({ ...descriptor, sha256: 'abc123' })).toThrow(/sha256/i);
    expect(() => validateModelAssetDescriptor({ ...descriptor, sha256: 'z'.repeat(64) })).toThrow(/sha256/i);
  });

  it('rejects unexpected mediaType', async () => {
    const { descriptor } = await makeTestAsset('valid');
    const invalid = { ...descriptor, mediaType: 'text/plain' as unknown as 'application/octet-stream' };
    expect(() => validateModelAssetDescriptor(invalid)).toThrow(/mediaType/i);
  });
});

describe('ModelAssetStore OPFS operations', () => {
  it('throws ModelAssetStorageUnavailableError when OPFS getDirectory is unavailable', async () => {
    const { descriptor } = await makeTestAsset('content');
    const originalNavigator = globalThis.navigator;
    try {
      vi.stubGlobal('navigator', {});
      const store = createModelAssetStore();
      await expect(store.ensureAsset(descriptor)).rejects.toThrow(ModelAssetStorageUnavailableError);
    } finally {
      vi.stubGlobal('navigator', originalNavigator);
    }
  });

  it('cache miss downloads via streaming, verifies size and sha256, and writes verified.json marker', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('piano-model-binary-weights-12345');

    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCount += 1;
      return new Response(bytes, {
        status: 200,
        headers: { 'content-length': String(bytes.byteLength) },
      });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    const result = await store.ensureAsset(descriptor);
    expect(result.diagnostics.source).toBe('network');
    expect(result.bytes).toEqual(bytes);
    expect(result.diagnostics.byteSize).toBe(bytes.byteLength);
    expect(result.diagnostics.sha256).toBe(descriptor.sha256);
    expect(fetchCount).toBe(1);

    // Verify file layout in OPFS
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;

    const binHandle = (await entryDir.getFileHandle('model.bin')) as unknown as MemoryFileHandle;
    expect(binHandle.getData()).toEqual(bytes);

    const markerHandle = (await entryDir.getFileHandle('verified.json')) as unknown as MemoryFileHandle;
    const marker = JSON.parse(new TextDecoder().decode(markerHandle.getData()));
    expect(marker).toMatchObject({
      schemaVersion: 1,
      assetId: descriptor.assetId,
      assetVersion: descriptor.assetVersion,
      expectedByteSize: descriptor.expectedByteSize,
      sha256: descriptor.sha256.toLowerCase(),
    });
    expect(typeof marker.verifiedAt).toBe('string');
  });

  it('cache hit issues ZERO network requests and returns verified cached bytes', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('piano-weights-cache-hit-test');

    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCount += 1;
      return new Response(bytes, { status: 200 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // 1st load: network
    const firstResult = await store.ensureAsset(descriptor);
    expect(firstResult.diagnostics.source).toBe('network');
    expect(fetchCount).toBe(1);

    // 2nd load: cache hit
    const secondResult = await store.ensureAsset(descriptor);
    expect(secondResult.diagnostics.source).toBe('opfs-cache');
    expect(secondResult.bytes).toEqual(bytes);
    expect(secondResult.diagnostics.sha256).toBe(descriptor.sha256);
    expect(fetchCount).toBe(1); // Still 1! 0 additional requests
  });

  it('rejects downloaded data with wrong byte size and leaves no active marker', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { descriptor } = await makeTestAsset('correct-content');
    const wrongBytes = new TextEncoder().encode('short'); // wrong size

    const mockFetch = vi.fn().mockResolvedValue(new Response(wrongBytes, { status: 200 }));
    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    await expect(store.ensureAsset(descriptor)).rejects.toThrow(ModelAssetIntegrityError);

    // Marker must NOT exist
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;

    await expect(entryDir.getFileHandle('verified.json')).rejects.toThrow();
  });

  it('rejects downloaded data with wrong SHA-256 and leaves no active marker', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { descriptor } = await makeTestAsset('expected-content-abcde');
    // Same length (22 bytes), different content
    const corruptBytes = new TextEncoder().encode('corrupt-content-123456');
    expect(corruptBytes.byteLength).toBe(descriptor.expectedByteSize);

    const mockFetch = vi.fn().mockResolvedValue(new Response(corruptBytes, { status: 200 }));
    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    await expect(store.ensureAsset(descriptor)).rejects.toThrow(ModelAssetIntegrityError);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
    await expect(entryDir.getFileHandle('verified.json')).rejects.toThrow();
  });

  it('missing verified.json marker is treated as incomplete cache and triggers redownload', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('model-weights-incomplete-test');

    // Pre-populate model.bin without verified.json
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets', { create: true })) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1', { create: true })) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId, { create: true })) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase(), { create: true })) as unknown as MemoryDirectoryHandle;
    const binHandle = (await entryDir.getFileHandle('model.bin', { create: true })) as unknown as MemoryFileHandle;
    binHandle.setData(bytes);

    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCount += 1;
      return new Response(bytes, { status: 200 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    const result = await store.ensureAsset(descriptor);
    expect(result.diagnostics.source).toBe('network');
    expect(fetchCount).toBe(1);

    // Marker must now exist
    expect(await entryDir.getFileHandle('verified.json')).toBeDefined();
  });

  it('corrupt cached file is rejected; if offline, throws download error and never returns corrupt bytes', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('pristine-model-weights');

    const mockFetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));
    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // Populate valid cache
    await store.ensureAsset(descriptor);

    // Tamper with cached model.bin
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
    const binHandle = (await entryDir.getFileHandle('model.bin')) as unknown as MemoryFileHandle;

    const tampered = new Uint8Array(bytes);
    tampered[0] = tampered[0] ^ 0xff; // flip byte
    binHandle.setData(tampered);

    // Now simulate offline: fetch fails
    const offlineFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const offlineStore = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: offlineFetch,
    });

    // Must fail, NOT return tampered bytes
    await expect(offlineStore.ensureAsset(descriptor)).rejects.toThrow(ModelAssetDownloadError);
  });

  it('single-flights concurrent calls for the same SHA', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('concurrent-model-download');

    let fetchCount = 0;
    let resolveResponse: (resp: Response) => void;
    const responsePromise = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });

    const mockFetch = vi.fn().mockImplementation(() => {
      fetchCount += 1;
      return responsePromise;
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    const req1 = store.ensureAsset(descriptor);
    const req2 = store.ensureAsset(descriptor);

    resolveResponse!(new Response(bytes, { status: 200 }));

    const [res1, res2] = await Promise.all([req1, req2]);
    expect(res1.bytes).toEqual(bytes);
    expect(res2.bytes).toEqual(bytes);
    expect(fetchCount).toBe(1); // Only ONE network fetch executed!
  });

  it('different SHAs do not collide in flight', async () => {
    const root = new MemoryDirectoryHandle('root');
    const assetA = await makeTestAsset('asset-a-content', 'model-a');
    const assetB = await makeTestAsset('asset-b-content', 'model-b');

    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCount += 1;
      if (url.includes(assetA.sha256)) {
        return new Response(assetA.bytes, { status: 200 });
      }
      return new Response(assetB.bytes, { status: 200 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    const [resA, resB] = await Promise.all([
      store.ensureAsset(assetA.descriptor),
      store.ensureAsset(assetB.descriptor),
    ]);

    expect(resA.bytes).toEqual(assetA.bytes);
    expect(resB.bytes).toEqual(assetB.bytes);
    expect(fetchCount).toBe(2);
  });

  it('network failure leaves no active marker and redacts sensitive URL tokens', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { descriptor } = await makeTestAsset('fail-content');

    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection reset by peer'));
    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    let thrownError: Error | null = null;
    try {
      await store.ensureAsset(descriptor);
    } catch (err) {
      thrownError = err as Error;
    }

    expect(thrownError).toBeInstanceOf(ModelAssetDownloadError);
    // Sensitive token must NOT be leaked
    expect(thrownError?.message).not.toContain('token=secret123');
  });

  it('two different assetIds can coexist and loading/upgrading asset A never deletes asset B', async () => {
    const root = new MemoryDirectoryHandle('root');
    const assetA1 = await makeTestAsset('model-a-sha1-weights', 'note-model', 'v1.0.0');
    const assetA2 = await makeTestAsset('model-a-sha2-weights', 'note-model', 'v2.0.0');
    const assetB = await makeTestAsset('model-b-sha1-weights', 'pedal-model', 'v1.0.0');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(assetA1.sha256)) return new Response(assetA1.bytes, { status: 200 });
      if (url.includes(assetA2.sha256)) return new Response(assetA2.bytes, { status: 200 });
      if (url.includes(assetB.sha256)) return new Response(assetB.bytes, { status: 200 });
      return new Response(null, { status: 404 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // 1. Download Model B (pedal-model)
    await store.ensureAsset(assetB.descriptor);

    // 2. Download Model A1 (note-model)
    await store.ensureAsset(assetA1.descriptor);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;

    const pedalDir = (await v1Dir.getDirectoryHandle('pedal-model')) as unknown as MemoryDirectoryHandle;
    const noteDir = (await v1Dir.getDirectoryHandle('note-model')) as unknown as MemoryDirectoryHandle;

    // Both coexist
    expect(await pedalDir.getDirectoryHandle(assetB.sha256.toLowerCase())).toBeDefined();
    expect(await noteDir.getDirectoryHandle(assetA1.sha256.toLowerCase())).toBeDefined();

    // 3. Upgrade Model A to A2
    await store.ensureAsset(assetA2.descriptor);

    // In note-model: A2 exists, A1 is pruned
    expect(await noteDir.getDirectoryHandle(assetA2.sha256.toLowerCase())).toBeDefined();
    await expect(noteDir.getDirectoryHandle(assetA1.sha256.toLowerCase())).rejects.toThrow();

    // In pedal-model: B is STILL completely intact!
    expect(await pedalDir.getDirectoryHandle(assetB.sha256.toLowerCase())).toBeDefined();
  });

  it('A SHA1 -> A SHA2: SHA2 verified before SHA1 prune', async () => {
    const root = new MemoryDirectoryHandle('root');
    const assetA1 = await makeTestAsset('note-model-content-v1', 'note-model', 'v1.0.0');
    const assetA2 = await makeTestAsset('note-model-content-v2', 'note-model', 'v2.0.0');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(assetA1.sha256)) return new Response(assetA1.bytes, { status: 200 });
      if (url.includes(assetA2.sha256)) return new Response(assetA2.bytes, { status: 200 });
      return new Response(null, { status: 404 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // Step 1: Populate A1
    await store.ensureAsset(assetA1.descriptor);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const noteDir = (await v1Dir.getDirectoryHandle('note-model')) as unknown as MemoryDirectoryHandle;
    expect(await noteDir.getDirectoryHandle(assetA1.sha256.toLowerCase())).toBeDefined();

    // Step 2: Load A2 -> A2 is completely verified before A1 is pruned
    await store.ensureAsset(assetA2.descriptor);
    expect(await noteDir.getDirectoryHandle(assetA2.sha256.toLowerCase())).toBeDefined();
    await expect(noteDir.getDirectoryHandle(assetA1.sha256.toLowerCase())).rejects.toThrow();
  });

  it('A SHA2 failure: SHA1 remains on disk but SHA1 is NOT returned as fallback', async () => {
    const root = new MemoryDirectoryHandle('root');
    const assetA1 = await makeTestAsset('note-model-content-v1', 'note-model', 'v1.0.0');
    const assetA2 = await makeTestAsset('note-model-content-v2', 'note-model', 'v2.0.0');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(assetA1.sha256)) return new Response(assetA1.bytes, { status: 200 });
      return new Response('Download failed', { status: 500 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // 1. Load A1
    await store.ensureAsset(assetA1.descriptor);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const noteDir = (await v1Dir.getDirectoryHandle('note-model')) as unknown as MemoryDirectoryHandle;
    expect(await noteDir.getDirectoryHandle(assetA1.sha256.toLowerCase())).toBeDefined();

    // 2. Load A2 -> must throw, NOT return A1
    await expect(store.ensureAsset(assetA2.descriptor)).rejects.toThrow(ModelAssetDownloadError);

    // 3. A1 must still remain on disk
    expect(await noteDir.getDirectoryHandle(assetA1.sha256.toLowerCase())).toBeDefined();
  });

  it('cache hit performs scoped cleanup of stale/incomplete sibling SHA', async () => {
    const root = new MemoryDirectoryHandle('root');
    const active = await makeTestAsset('note-model-active', 'note-model', 'v1.0.0');
    const stale = await makeTestAsset('note-model-stale', 'note-model', 'v0.9.0');
    const otherAsset = await makeTestAsset('pedal-model-active', 'pedal-model', 'v1.0.0');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(active.sha256)) return new Response(active.bytes, { status: 200 });
      if (url.includes(otherAsset.sha256)) return new Response(otherAsset.bytes, { status: 200 });
      return new Response(null, { status: 404 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // Populate active note model and pedal model
    await store.ensureAsset(active.descriptor);
    await store.ensureAsset(otherAsset.descriptor);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const noteDir = (await v1Dir.getDirectoryHandle('note-model')) as unknown as MemoryDirectoryHandle;
    const pedalDir = (await v1Dir.getDirectoryHandle('pedal-model')) as unknown as MemoryDirectoryHandle;

    // Simulate an incomplete/stale sibling folder created under note-model
    const staleDir = await noteDir.getDirectoryHandle(stale.sha256.toLowerCase(), { create: true });
    const staleBin = await staleDir.getFileHandle('model.bin', { create: true });
    staleBin.setData(stale.bytes); // Incomplete: no verified.json

    expect(await noteDir.getDirectoryHandle(stale.sha256.toLowerCase())).toBeDefined();

    // Now trigger a cache hit on active note-model
    const fetchCountBefore = mockFetch.mock.calls.length;
    const cacheHitResult = await store.ensureAsset(active.descriptor);
    expect(cacheHitResult.diagnostics.source).toBe('opfs-cache');
    expect(mockFetch.mock.calls.length).toBe(fetchCountBefore); // 0 new network requests

    // Sibling stale folder under note-model must be cleaned up
    await expect(noteDir.getDirectoryHandle(stale.sha256.toLowerCase())).rejects.toThrow();

    // Active note-model must remain
    expect(await noteDir.getDirectoryHandle(active.sha256.toLowerCase())).toBeDefined();

    // Other asset pedal-model must be completely untouched!
    expect(await pedalDir.getDirectoryHandle(otherAsset.sha256.toLowerCase())).toBeDefined();
  });

  it('same SHA + changed assetVersion: zero network, marker metadata refreshed', async () => {
    const root = new MemoryDirectoryHandle('root');
    const assetV1 = await makeTestAsset('same-binary-different-version', 'note-model', 'v1.0.0');

    let fetchCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      fetchCount += 1;
      return new Response(assetV1.bytes, { status: 200 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // 1. Initial load
    await store.ensureAsset(assetV1.descriptor);
    expect(fetchCount).toBe(1);

    // 2. Load same SHA but new assetVersion descriptor
    const assetV2Descriptor: ModelAssetDescriptor = {
      ...assetV1.descriptor,
      assetVersion: 'v2.0.0',
    };

    const result = await store.ensureAsset(assetV2Descriptor);
    expect(result.diagnostics.source).toBe('opfs-cache');
    expect(result.bytes).toEqual(assetV1.bytes);
    expect(fetchCount).toBe(1); // ZERO network requests for binary!

    // Verify verified.json has been refreshed with new assetVersion
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const noteDir = (await v1Dir.getDirectoryHandle('note-model')) as unknown as MemoryDirectoryHandle;
    const entryDir = (await noteDir.getDirectoryHandle(assetV1.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;

    const markerHandle = await entryDir.getFileHandle('verified.json');
    const marker = JSON.parse(new TextDecoder().decode((markerHandle as unknown as MemoryFileHandle).getData()));
    expect(marker.assetVersion).toBe('v2.0.0');
    expect(marker.sha256).toBe(assetV1.sha256.toLowerCase());
  });

  it('writable.write quota/storage failure -> ModelAssetStorageError -> no verified marker', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('storage-write-failure-weights');

    const mockFetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));

    // Intercept model.bin to throw on write
    root.onGetFileHandle = (name) => {
      if (name === 'model.bin') {
        const file = new MemoryFileHandle(name);
        file.beforeWrite = async () => {
          throw new Error('QuotaExceededError: disk full');
        };
        return file;
      }
      return undefined;
    };

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    await expect(store.ensureAsset(descriptor)).rejects.toThrow(ModelAssetStorageError);

    // verified.json must not exist
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
    await expect(entryDir.getFileHandle('verified.json')).rejects.toThrow();
  });

  it('writable.close storage failure -> ModelAssetStorageError -> no verified marker', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('storage-close-failure-weights');

    const mockFetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));

    // Intercept model.bin to throw on close
    root.onGetFileHandle = (name) => {
      if (name === 'model.bin') {
        const file = new MemoryFileHandle(name);
        file.beforeClose = async () => {
          throw new Error('I/O error during close');
        };
        return file;
      }
      return undefined;
    };

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    await expect(store.ensureAsset(descriptor)).rejects.toThrow(ModelAssetStorageError);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
    await expect(entryDir.getFileHandle('verified.json')).rejects.toThrow();
  });

  it('ReadableStream read failure -> ModelAssetDownloadError -> no verified marker', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { descriptor } = await makeTestAsset('network-stream-read-failure');

    const failingStream = new ReadableStream({
      start(controller) {
        controller.error(new Error('Network connection reset during streaming'));
      },
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(failingStream, { status: 200 }));

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    await expect(store.ensureAsset(descriptor)).rejects.toThrow(ModelAssetDownloadError);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
    await expect(entryDir.getFileHandle('verified.json')).rejects.toThrow();
  });

  it('marker-write failure -> ModelAssetStorageError -> asset inactive', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('marker-write-failure-weights');

    const mockFetch = vi.fn().mockResolvedValue(new Response(bytes, { status: 200 }));

    // Intercept verified.json to fail writable creation
    root.onGetFileHandle = (name, options) => {
      if (name === 'verified.json' && options?.create) {
        const file = new MemoryFileHandle(name);
        file.onCreateWritable = () => {
          throw new Error('Disk full: cannot write activation marker');
        };
        return file;
      }
      return undefined;
    };

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    await expect(store.ensureAsset(descriptor)).rejects.toThrow(ModelAssetStorageError);

    // verified.json must not exist / remain inactive
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    const assetDir = (await v1Dir.getDirectoryHandle(descriptor.assetId)) as unknown as MemoryDirectoryHandle;
    const entryDir = (await assetDir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
    await expect(entryDir.getFileHandle('verified.json')).rejects.toThrow();
  });
});

describe('ByteDance model loader integration with ModelAssetStore', () => {
  it('derives a valid ModelAssetDescriptor from ByteDanceModelManifest', () => {
    const manifest = defaultByteDanceModelManifest({
      modelUrl: 'https://cdn.example.com/bytedance.onnx',
      expectedByteSize: 98_691_493,
      sha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
    });
    const descriptor = byteDanceManifestToModelAssetDescriptor(manifest);
    expect(descriptor.schemaVersion).toBe(1);
    expect(descriptor.assetId).toBe('bytedance-piano-transcription-note-model');
    expect(descriptor.assetVersion).toBe('CRNN_note_F1_0.9677_pedal_F1_0.9186');
    expect(descriptor.expectedByteSize).toBe(98_691_493);
    expect(descriptor.sha256).toBe('6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5');
    expect(descriptor.mediaType).toBe('application/octet-stream');
  });

  it('createOpfsByteDanceModelLoader uses ModelAssetStore and returns bytes + diagnostics', async () => {
    const root = new MemoryDirectoryHandle('root');
    const sample = await makeTestAsset('bytedance-onnx-bytes-simulated');
    const manifest = defaultByteDanceModelManifest({
      modelUrl: sample.descriptor.url,
      expectedByteSize: sample.descriptor.expectedByteSize,
      sha256: sample.descriptor.sha256,
    });

    const mockFetch = vi.fn().mockResolvedValue(new Response(sample.bytes, { status: 200 }));
    const loader = createOpfsByteDanceModelLoader({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    const loaded = await loader(manifest);
    expect(loaded).toMatchObject({
      bytes: sample.bytes,
      source: 'network',
    });
  });
});
