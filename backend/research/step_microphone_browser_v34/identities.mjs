import assert from 'node:assert/strict';
import { bytes, rawBytesSha256 } from './io.mjs';
export const RAW = 'SHA256_WORKTREE_MATERIALIZATION', CANONICAL = 'CANONICAL_JSON_UTF8_SHA256';
export const rawFileSha256 = async (path, read = bytes) => rawBytesSha256(await read(path));
// Exact read-only equivalent of the frozen production semantic algorithm.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}
export const canonicalJsonSha256 = value => rawBytesSha256(Buffer.from(canonicalJson(value), 'utf8'));
export async function verifyWorktreeMaterialization(path, expectedWorktreeSha256, expectedBytes, read = bytes) {
  const b = await read(path), hash = rawBytesSha256(b);
  if (expectedWorktreeSha256 !== undefined) assert.equal(hash, expectedWorktreeSha256, 'WORKTREE_MATERIALIZATION_SHA256:' + path);
  if (expectedBytes !== undefined) assert.equal(b.length, expectedBytes, 'WORKTREE_BYTES:' + path);
  return { path, domain: 'WORKTREE_MATERIALIZATION', representation: RAW,
    subject: { kind: 'LOCAL_CHECKOUT_FILE_BYTES', path }, sha256: hash, bytes: b.length };
}
export async function verifyExternalLocalAsset(path, expectedRawSha256, expectedBytes, read = bytes) {
  const b = await read(path), hash = rawBytesSha256(b);
  if (expectedRawSha256 !== undefined) assert.equal(hash, expectedRawSha256, 'EXTERNAL_LOCAL_ASSET_SHA256:' + path);
  if (expectedBytes !== undefined) assert.equal(b.length, expectedBytes, 'EXTERNAL_LOCAL_ASSET_BYTES:' + path);
  return { path, domain: 'EXTERNAL_LOCAL_ASSET', representation: 'RAW_BYTES_SHA256',
    subject: { kind: 'LOCAL_EXECUTION_ASSET_BYTES', path }, sha256: hash, bytes: b.length };
}
export async function verifyCanonicalJsonIdentity(path, expectedSemanticSha256, read = bytes) {
  const hash = canonicalJsonSha256(JSON.parse(await read(path))); assert.equal(hash, expectedSemanticSha256, 'CANONICAL_JSON_UTF8_SHA256:' + path);
  return { path, domain: 'CANONICAL_JSON_SEMANTIC_IDENTITY', representation: CANONICAL,
    subject: { kind: 'PARSED_JSON_CANONICAL_UTF8', path, algorithm: 'Frozen production canonicalJson' }, sha256: hash };
}
export async function verifyLocalRecord(record) {
  assert.ok(record.subject && record.representation);
  if (record.domain === 'WORKTREE_MATERIALIZATION') return verifyWorktreeMaterialization(record.path, record.sha256, record.bytes);
  if (record.domain === 'EXTERNAL_LOCAL_ASSET') return verifyExternalLocalAsset(record.path, record.sha256, record.bytes);
  if (record.domain === 'CANONICAL_JSON_SEMANTIC_IDENTITY') return verifyCanonicalJsonIdentity(record.path, record.sha256);
  throw Error('NOT_A_LOCAL_IDENTITY_DOMAIN:' + record.domain);
}
