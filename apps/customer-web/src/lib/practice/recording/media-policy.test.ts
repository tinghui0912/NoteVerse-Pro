import { expect, it } from 'vitest';
import { captureMediaExtension, isArchiveableCaptureMime, normalizeCaptureMime } from './media-policy';

it.each([
  ['AUDIO', 'audio/webm', 'webm'], ['AUDIO', 'audio/mp4', 'mp4'],
  ['AUDIO', 'audio/ogg', 'ogg'], ['AUDIO', 'audio/wav', 'wav'], ['AUDIO', 'audio/x-wav', 'wav'],
  ['VIDEO', 'video/webm', 'webm'], ['VIDEO', 'video/mp4', 'mp4'],
] as const)('admits %s %s with its raw file extension', (kind, mime, extension) => {
  const browserMime = ` ${mime.toUpperCase()} ;codecs=browser-selected`;
  expect(isArchiveableCaptureMime(kind, browserMime)).toBe(true);
  expect(normalizeCaptureMime(browserMime)).toBe(mime);
  expect(captureMediaExtension(browserMime)).toBe(extension);
});

it.each([
  ['VIDEO', 'audio/mp4'], ['AUDIO', 'video/mp4'],
  ['VIDEO', 'video/quicktime'], ['AUDIO', 'audio/unknown'], ['AUDIO', ''],
] as const)('rejects %s container %s', (kind, mime) => {
  expect(isArchiveableCaptureMime(kind, mime)).toBe(false);
});
