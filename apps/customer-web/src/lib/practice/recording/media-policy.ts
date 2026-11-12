import { CAPTURE_CONTAINERS } from './generated/media-policy';
import type { CaptureMediaKind } from './generated/media-policy';

export { VIDEO_CAPTURE_MIME_CANDIDATES } from './generated/media-policy';
export type { CaptureMediaKind } from './generated/media-policy';

export function normalizeCaptureMime(mimeType: string): string {
  return mimeType.split(';', 1)[0].trim().toLowerCase();
}

export function isSupportedCaptureMime(
  kind: CaptureMediaKind,
  mimeType: string,
): boolean {
  const canonical = normalizeCaptureMime(mimeType);
  return CAPTURE_CONTAINERS.some(
    (container) => container.kind === kind && container.mimeType === canonical,
  );
}

export function captureMediaExtension(mimeType: string): string {
  const canonical = normalizeCaptureMime(mimeType);
  const descriptor = CAPTURE_CONTAINERS.find(
    (container) => container.mimeType === canonical,
  );
  if (!descriptor) throw new Error('Unsupported capture container.');
  return descriptor.extension;
}
