export const ASSET_ID_REGEX = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export type ModelAssetDescriptor = {
  schemaVersion: 1;
  assetId: string;
  assetVersion: string;
  url: string;
  expectedByteSize: number;
  sha256: string;
  mediaType: 'application/octet-stream';
};

export type ModelAssetVerificationMarker = {
  schemaVersion: 1;
  assetId: string;
  assetVersion: string;
  expectedByteSize: number;
  sha256: string;
  verifiedAt: string;
};

export type ModelAssetProgress = {
  bytesDownloaded: number;
  totalBytes: number | null;
};

export type ModelAssetProgressCallback = (progress: ModelAssetProgress) => void;

export type ModelAssetLoadDiagnostics = {
  source: 'opfs-cache' | 'network';
  downloadMs?: number;
  cacheReadMs?: number;
  verificationMs: number;
  totalLoadMs: number;
  byteSize: number;
  sha256: string;
  persistentStorageGranted?: boolean | null;
};

export type ModelAssetLoadResult = {
  bytes: Uint8Array;
  diagnostics: ModelAssetLoadDiagnostics;
};

export type ModelAssetStoreOptions = {
  getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  fetch?: typeof fetch;
  persist?: () => Promise<boolean>;
  nowMs?: () => number;
};

export class ModelAssetStorageUnavailableError extends Error {
  constructor(message = 'OPFS storage is unavailable in this browser environment.') {
    super(message);
    this.name = 'ModelAssetStorageUnavailableError';
  }
}

export class ModelAssetDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelAssetDownloadError';
  }
}

export class ModelAssetIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelAssetIntegrityError';
  }
}

export class ModelAssetStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelAssetStorageError';
  }
}

export function sanitizeUrlForError(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl, 'http://127.0.0.1');
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'redacted-url';
  }
}
