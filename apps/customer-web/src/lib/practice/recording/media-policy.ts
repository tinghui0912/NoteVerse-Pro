export type CaptureMediaKind = 'AUDIO' | 'VIDEO';

const CAPTURE_CONTAINERS = {
  AUDIO: ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav'],
  VIDEO: ['video/webm', 'video/mp4'],
} as const;

/** Capture preferences are independent of the composed CompositeVideo encoder. */
export const VIDEO_CAPTURE_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const;

export function normalizeCaptureMime(mimeType: string): string {
  return mimeType.split(';')[0].trim().toLowerCase();
}

export function isArchiveableCaptureMime(kind: CaptureMediaKind, mimeType: string): boolean {
  return (CAPTURE_CONTAINERS[kind] as readonly string[]).includes(normalizeCaptureMime(mimeType));
}

export function captureMediaExtension(mimeType: string): string {
  const container = normalizeCaptureMime(mimeType);
  const extensions: Record<string, string> = {
    'audio/webm': 'webm', 'video/webm': 'webm',
    'audio/mp4': 'mp4', 'video/mp4': 'mp4',
    'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  };
  const extension = extensions[container];
  if (!extension) throw new Error('Unsupported capture container.');
  return extension;
}
