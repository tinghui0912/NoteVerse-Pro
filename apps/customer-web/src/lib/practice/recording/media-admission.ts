import { ORIGINAL_RECORDING_CONTAINERS } from './generated/media-admission';
import type { RecordingMediaKind } from './generated/media-admission';

export type { RecordingMediaKind } from './generated/media-admission';

export function normalizeRecordingMime(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

export function isAdmittedRecordingMime(
  kind: RecordingMediaKind,
  mimeType: string,
): boolean {
  const canonical = normalizeRecordingMime(mimeType);
  return ORIGINAL_RECORDING_CONTAINERS.some(
    (container) => container.kind === kind && container.mimeType === canonical,
  );
}

export function recordingMediaExtension(mimeType: string): string {
  const canonical = normalizeRecordingMime(mimeType);
  const descriptor = ORIGINAL_RECORDING_CONTAINERS.find(
    (container) => container.mimeType === canonical,
  );
  if (!descriptor) throw new Error('Unsupported original recording container.');
  return descriptor.extension;
}
