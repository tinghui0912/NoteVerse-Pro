import assert from 'node:assert/strict';
import { bytes, rawBytesSha256 } from './io.mjs';

export const RAW = 'RAW_FILE_BYTES_SHA256', CANONICAL = 'CANONICAL_JSON_UTF8_SHA256';
export const rawFileSha256 = async (path, read = bytes) => rawBytesSha256(await read(path));

// Read-only equivalent of the frozen production canonicalJson; no production acoustic code is executed.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
export const canonicalJsonSha256 = value => rawBytesSha256(Buffer.from(canonicalJson(value), 'utf8'));

export async function verifyRawFileIdentity(path, expectedRawSha256, expectedByteCount, read = bytes) {
  const raw = await read(path), actualRawSha256 = rawBytesSha256(raw);
  if (expectedRawSha256 !== undefined) assert.equal(actualRawSha256, expectedRawSha256, 'RAW_FILE_BYTES_SHA256:' + path);
  if (expectedByteCount !== undefined) assert.equal(raw.length, expectedByteCount, 'RAW_FILE_BYTE_COUNT:' + path);
  return { path, representation: RAW, sha256: actualRawSha256, bytes: raw.length };
}
export async function verifyCanonicalJsonIdentity(path, expectedCanonicalSha256, read = bytes) {
  const value = JSON.parse(await read(path)), actualCanonicalSha256 = canonicalJsonSha256(value);
  assert.equal(actualCanonicalSha256, expectedCanonicalSha256, 'CANONICAL_JSON_UTF8_SHA256:' + path);
  return { path, representation: CANONICAL, sha256: actualCanonicalSha256,
    algorithm: 'SHA256(UTF8(canonicalJson(JSON.parse(rawFileBytes))))', rawBytesAreNotNormalizedForRawComparisons: true };
}
