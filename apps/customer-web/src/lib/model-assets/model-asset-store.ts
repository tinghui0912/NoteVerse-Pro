import {
  type ModelAssetDescriptor,
  type ModelAssetLoadResult,
  type ModelAssetProgressCallback,
  type ModelAssetStoreOptions,
  type ModelAssetVerificationMarker,
  ModelAssetDownloadError,
  ModelAssetIntegrityError,
  ModelAssetStorageError,
  ModelAssetStorageUnavailableError,
  sanitizeUrlForError,
} from './types';

export const MODEL_ASSET_STORAGE_ROOT = 'noteverse-model-assets';
export const MODEL_ASSET_SCHEMA_VERSION_DIR = 'v1';

export class ModelAssetStore {
  private readonly inFlight = new Map<string, Promise<ModelAssetLoadResult>>();

  constructor(private readonly options: ModelAssetStoreOptions = {}) {}

  async ensureAsset(
    descriptor: ModelAssetDescriptor,
    onProgress?: ModelAssetProgressCallback
  ): Promise<ModelAssetLoadResult> {
    validateModelAssetDescriptor(descriptor);
    const key = descriptor.sha256.toLowerCase();
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const loadPromise = this.loadAssetInternal(descriptor, onProgress);
    this.inFlight.set(key, loadPromise);
    try {
      return await loadPromise;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async loadAssetInternal(
    descriptor: ModelAssetDescriptor,
    onProgress?: ModelAssetProgressCallback
  ): Promise<ModelAssetLoadResult> {
    const root = await this.getRootDirectory();
    const persistentStorageGranted = await this.requestPersistence();
    const loadStartedAt = this.now();

    const baseDir = await root.getDirectoryHandle(MODEL_ASSET_STORAGE_ROOT, { create: true });
    const v1Dir = await baseDir.getDirectoryHandle(MODEL_ASSET_SCHEMA_VERSION_DIR, { create: true });
    const targetDirName = descriptor.sha256.toLowerCase();
    const entryDir = await v1Dir.getDirectoryHandle(targetDirName, { create: true });

    // Step 1: Check existing cache entry
    const cacheResult = await this.tryReadCachedAsset(entryDir, descriptor, loadStartedAt, persistentStorageGranted);
    if (cacheResult) {
      return cacheResult;
    }

    // Step 2: Cache miss or invalid/corrupt cache -> clean up any incomplete/corrupt files before redownload
    await entryDir.removeEntry('verified.json').catch(() => undefined);
    await entryDir.removeEntry('model.bin').catch(() => undefined);

    // Step 3: Direct streaming download to OPFS
    const fetchImpl = this.options.fetch ?? globalThis.fetch;
    let response: Response;
    try {
      response = await fetchImpl(descriptor.url);
    } catch (error) {
      throw new ModelAssetDownloadError(
        `Network fetch failed for ${sanitizeUrlForError(descriptor.url)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!response.ok) {
      throw new ModelAssetDownloadError(
        `Download failed with HTTP ${response.status} for ${sanitizeUrlForError(descriptor.url)}.`
      );
    }

    if (!response.body) {
      throw new ModelAssetDownloadError(
        `Download response body is empty for ${sanitizeUrlForError(descriptor.url)}.`
      );
    }

    const downloadStartedAt = this.now();
    let binHandle: FileSystemFileHandle;
    try {
      binHandle = await entryDir.getFileHandle('model.bin', { create: true });
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to create model.bin: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    let writable: FileSystemWritableFileStream;
    try {
      writable = await binHandle.createWritable();
    } catch (error) {
      throw new ModelAssetStorageError(
        `Failed to open writable stream for model.bin: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const totalBytesHeader = response.headers.get('content-length');
    const totalBytes = totalBytesHeader ? Number(totalBytesHeader) : null;
    let bytesDownloaded = 0;
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        await writable.write(value);
        bytesDownloaded += value.byteLength;
        onProgress?.({
          bytesDownloaded,
          totalBytes: Number.isFinite(totalBytes) ? totalBytes : null,
        });
      }
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      await entryDir.removeEntry('model.bin').catch(() => undefined);
      throw new ModelAssetDownloadError(
        `Streaming download failed for ${sanitizeUrlForError(descriptor.url)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const downloadMs = this.now() - downloadStartedAt;

    // Step 4: Verify freshly downloaded bytes from OPFS
    const readStartedAt = this.now();
    const file = await binHandle.getFile();
    const bytes = new Uint8Array(await file.arrayBuffer());
    const cacheReadMs = this.now() - readStartedAt;

    if (bytes.byteLength !== descriptor.expectedByteSize) {
      await entryDir.removeEntry('model.bin').catch(() => undefined);
      throw new ModelAssetIntegrityError(
        `Downloaded model byte size mismatch: expected ${descriptor.expectedByteSize}, got ${bytes.byteLength}.`
      );
    }

    const verifyStartedAt = this.now();
    const digest = await computeSha256Hex(bytes);
    const verificationMs = this.now() - verifyStartedAt;

    if (digest.toLowerCase() !== descriptor.sha256.toLowerCase()) {
      await entryDir.removeEntry('model.bin').catch(() => undefined);
      throw new ModelAssetIntegrityError(
        `Downloaded model SHA256 mismatch: expected ${descriptor.sha256}, got ${digest}.`
      );
    }

    // Step 5: Write activation marker (payload first, verification marker last)
    const marker: ModelAssetVerificationMarker = {
      schemaVersion: 1,
      assetId: descriptor.assetId,
      assetVersion: descriptor.assetVersion,
      expectedByteSize: descriptor.expectedByteSize,
      sha256: descriptor.sha256.toLowerCase(),
      verifiedAt: new Date().toISOString(),
    };
    try {
      const markerHandle = await entryDir.getFileHandle('verified.json', { create: true });
      const markerWritable = await markerHandle.createWritable();
      await markerWritable.write(JSON.stringify(marker, null, 2));
      await markerWritable.close();
    } catch (error) {
      await entryDir.removeEntry('verified.json').catch(() => undefined);
      await entryDir.removeEntry('model.bin').catch(() => undefined);
      throw new ModelAssetStorageError(
        `Failed to write activation marker: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Step 6: Prune other versions only after new asset is verified and active
    await this.pruneOtherVersions(v1Dir, targetDirName);

    return {
      bytes,
      diagnostics: {
        source: 'network',
        downloadMs,
        cacheReadMs,
        verificationMs,
        totalLoadMs: this.now() - loadStartedAt,
        byteSize: bytes.byteLength,
        sha256: descriptor.sha256,
        persistentStorageGranted,
      },
    };
  }

  private async tryReadCachedAsset(
    entryDir: FileSystemDirectoryHandle,
    descriptor: ModelAssetDescriptor,
    loadStartedAt: number,
    persistentStorageGranted: boolean | null
  ): Promise<ModelAssetLoadResult | null> {
    let markerHandle: FileSystemFileHandle | null = null;
    try {
      markerHandle = await entryDir.getFileHandle('verified.json');
    } catch {
      return null;
    }

    try {
      const markerFile = await markerHandle.getFile();
      const markerText = await markerFile.text();
      const marker = JSON.parse(markerText) as ModelAssetVerificationMarker;
      if (
        marker.schemaVersion !== 1 ||
        marker.assetId !== descriptor.assetId ||
        marker.expectedByteSize !== descriptor.expectedByteSize ||
        marker.sha256.toLowerCase() !== descriptor.sha256.toLowerCase()
      ) {
        return null;
      }
    } catch {
      return null;
    }

    let binHandle: FileSystemFileHandle | null = null;
    try {
      binHandle = await entryDir.getFileHandle('model.bin');
    } catch {
      return null;
    }

    try {
      const readStartedAt = this.now();
      const file = await binHandle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const cacheReadMs = this.now() - readStartedAt;

      if (bytes.byteLength !== descriptor.expectedByteSize) {
        return null;
      }

      const verifyStartedAt = this.now();
      const digest = await computeSha256Hex(bytes);
      const verificationMs = this.now() - verifyStartedAt;

      if (digest.toLowerCase() !== descriptor.sha256.toLowerCase()) {
        return null;
      }

      return {
        bytes,
        diagnostics: {
          source: 'opfs-cache',
          cacheReadMs,
          verificationMs,
          totalLoadMs: this.now() - loadStartedAt,
          byteSize: bytes.byteLength,
          sha256: descriptor.sha256,
          persistentStorageGranted,
        },
      };
    } catch {
      return null;
    }
  }

  private async pruneOtherVersions(v1Dir: FileSystemDirectoryHandle, activeDirName: string): Promise<void> {
    try {
      const entries = v1Dir.entries?.();
      if (entries && typeof entries[Symbol.asyncIterator] === 'function') {
        for await (const [name, handle] of entries) {
          if (handle.kind === 'directory' && name.toLowerCase() !== activeDirName.toLowerCase()) {
            await v1Dir.removeEntry(name, { recursive: true }).catch(() => undefined);
          }
        }
      }
    } catch {
      // Best-effort pruning; failure does not block the active model
    }
  }

  private async getRootDirectory(): Promise<FileSystemDirectoryHandle> {
    if (this.options.getDirectory) {
      return this.options.getDirectory();
    }
    if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
      throw new ModelAssetStorageUnavailableError();
    }
    return navigator.storage.getDirectory();
  }

  private async requestPersistence(): Promise<boolean | null> {
    if (this.options.persist) {
      return this.options.persist();
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
        return await navigator.storage.persist();
      }
    } catch {
      return null;
    }
    return null;
  }

  private now(): number {
    return this.options.nowMs?.() ?? globalThis.performance?.now?.() ?? Date.now();
  }
}

export function createModelAssetStore(options?: ModelAssetStoreOptions): ModelAssetStore {
  return new ModelAssetStore(options);
}

export function validateModelAssetDescriptor(descriptor: ModelAssetDescriptor): void {
  if (descriptor.schemaVersion !== 1) {
    throw new Error('Unsupported model asset descriptor schema version.');
  }
  if (!descriptor.assetId || typeof descriptor.assetId !== 'string') {
    throw new Error('Model asset descriptor must include an assetId.');
  }
  if (!descriptor.assetVersion || typeof descriptor.assetVersion !== 'string') {
    throw new Error('Model asset descriptor must include an assetVersion.');
  }
  if (!descriptor.url || typeof descriptor.url !== 'string') {
    throw new Error('Model asset descriptor must include a URL.');
  }
  if (!Number.isFinite(descriptor.expectedByteSize) || descriptor.expectedByteSize <= 0) {
    throw new Error('Model asset descriptor expectedByteSize must be a positive number.');
  }
  if (!/^[a-f0-9]{64}$/i.test(descriptor.sha256)) {
    throw new Error('Model asset descriptor sha256 must be a 64-character hex string.');
  }
  if (descriptor.mediaType !== 'application/octet-stream') {
    throw new Error("Model asset descriptor mediaType must be 'application/octet-stream'.");
  }
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable; cannot verify model integrity.');
  }
  const copy = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}
