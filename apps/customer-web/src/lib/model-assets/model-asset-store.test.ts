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
  ModelAssetStorageUnavailableError,
} from './types';
import { byteDanceManifestToModelAssetDescriptor, createOpfsByteDanceModelLoader } from './bytedance-model-loader';
import { defaultByteDanceModelManifest } from '../practice/acoustic-inference/bytedance-contract';

class MemoryWritableStream implements FileSystemWritableFileStream {
  readonly locked = false;
  private buffer: number[] = [];
  private closed = false;
  private aborted = false;

  constructor(private readonly onCommit: (bytes: Uint8Array) => void) {}

  async write(data: unknown): Promise<void> {
    if (this.closed || this.aborted) {
      throw new Error('Cannot write to closed stream');
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
    return new MemoryWritableStream((committed) => {
      this.data = committed;
    });
  }

  async isSameEntry(other: unknown): Promise<boolean> {
    return other === this;
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly entriesMap = new Map<string, MemoryFileHandle | MemoryDirectoryHandle>();

  constructor(readonly name: string) {}

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFileHandle> {
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
      return existing;
    }
    if (options?.create) {
      const created = new MemoryDirectoryHandle(name);
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
    const entryDir = (await v1Dir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;

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
    const entryDir = (await v1Dir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;

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
    const entryDir = (await v1Dir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
    await expect(entryDir.getFileHandle('verified.json')).rejects.toThrow();
  });

  it('missing verified.json marker is treated as incomplete cache and triggers redownload', async () => {
    const root = new MemoryDirectoryHandle('root');
    const { bytes, descriptor } = await makeTestAsset('model-weights-incomplete-test');

    // Pre-populate model.bin without verified.json
    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets', { create: true })) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1', { create: true })) as unknown as MemoryDirectoryHandle;
    const entryDir = (await v1Dir.getDirectoryHandle(descriptor.sha256.toLowerCase(), { create: true })) as unknown as MemoryDirectoryHandle;
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
    const entryDir = (await v1Dir.getDirectoryHandle(descriptor.sha256.toLowerCase())) as unknown as MemoryDirectoryHandle;
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

  it('new model B is completely verified before old model A is pruned', async () => {
    const root = new MemoryDirectoryHandle('root');
    const assetA = await makeTestAsset('model-generation-a', 'model-a');
    const assetB = await makeTestAsset('model-generation-b', 'model-b');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(assetA.sha256)) return new Response(assetA.bytes, { status: 200 });
      if (url.includes(assetB.sha256)) return new Response(assetB.bytes, { status: 200 });
      return new Response(null, { status: 404 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // 1. Download and verify Model A
    await store.ensureAsset(assetA.descriptor);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;

    // Verify A exists
    expect(await v1Dir.getDirectoryHandle(assetA.sha256.toLowerCase())).toBeDefined();

    // 2. Download and verify Model B
    await store.ensureAsset(assetB.descriptor);

    // Verify B exists and A is now pruned
    expect(await v1Dir.getDirectoryHandle(assetB.sha256.toLowerCase())).toBeDefined();
    await expect(v1Dir.getDirectoryHandle(assetA.sha256.toLowerCase())).rejects.toThrow();
  });

  it('model B failure keeps model A on disk but does not fallback to A', async () => {
    const root = new MemoryDirectoryHandle('root');
    const assetA = await makeTestAsset('model-version-a-valid', 'model-a');
    const assetB = await makeTestAsset('model-version-b-failing', 'model-b');

    const mockFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes(assetA.sha256)) return new Response(assetA.bytes, { status: 200 });
      // B fails with 500
      return new Response('Server error', { status: 500 });
    });

    const store = new ModelAssetStore({
      getDirectory: async () => root.asDirectoryHandle(),
      fetch: mockFetch,
    });

    // 1. Load A
    await store.ensureAsset(assetA.descriptor);

    const baseDir = (await root.getDirectoryHandle('noteverse-model-assets')) as unknown as MemoryDirectoryHandle;
    const v1Dir = (await baseDir.getDirectoryHandle('v1')) as unknown as MemoryDirectoryHandle;
    expect(await v1Dir.getDirectoryHandle(assetA.sha256.toLowerCase())).toBeDefined();

    // 2. Load B -> must throw, NOT return A
    await expect(store.ensureAsset(assetB.descriptor)).rejects.toThrow(ModelAssetDownloadError);

    // 3. Model A must still be preserved on disk
    expect(await v1Dir.getDirectoryHandle(assetA.sha256.toLowerCase())).toBeDefined();
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
