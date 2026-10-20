import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { git, gitBytes, sha256 } from './discovery.mjs';
export function rawFileIdentity(path, domain = 'WORKTREE_MATERIALIZATION') {
  const bytes = readFileSync(path);
  return { subject: path, domain, representation: 'RAW_BYTES_SHA256', byteSize: bytes.length, sha256: sha256(bytes) };
}
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}
export function canonicalIdentity(path) {
  return { subject: path, domain: 'CANONICAL_JSON_SEMANTIC_IDENTITY', representation: 'CANONICAL_JSON_UTF8_SHA256',
    sha256: sha256(Buffer.from(canonicalJson(JSON.parse(readFileSync(path))))) };
}
export function gitIdentity(path, commit) {
  const blob = git('rev-parse', commit + ':' + path), bytes = gitBytes('show', commit + ':' + path);
  return { subject: path, commit, domain: 'GIT_OBJECT_CONTENT', representation: 'SHA256_GIT_OBJECT_CONTENT', blob,
    sha256: sha256(bytes), byteSize: bytes.length };
}
export function verifyGitIdentities(records, commit) {
  return records.map(record => { const current = gitIdentity(record.subject, commit);
    assert.equal(current.blob, record.blob); assert.equal(current.sha256, record.sha256);
    return { subject: record.subject, startingGitObject: record.blob, currentGitObject: current.blob, equal: true };
  });
}
export function verifyRawIdentity(record) {
  const current = rawFileIdentity(record.subject, record.domain);
  assert.equal(current.sha256, record.sha256); assert.equal(current.byteSize, record.byteSize); return current;
}
