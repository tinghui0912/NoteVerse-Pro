import assert from 'node:assert/strict';
import { git, gitBytes, rawBytesSha256, bytes, DIR, OUT } from './io.mjs';
export function gitTree(ref) {
  const map = new Map();
  for (const row of gitBytes('ls-tree', '-r', '-z', ref).toString().split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'), [mode, type, objectId] = row.slice(0, tab).split(' '), path = row.slice(tab + 1);
    if (type === 'blob') map.set(path, { path, mode, objectId });
  }
  return map;
}
export function gitObjectRecord(path, ref, tree = gitTree(ref)) {
  const item = tree.get(path); assert.ok(item, 'TRACKED_GIT_OBJECT_REQUIRED:' + path);
  return { path, domain: 'GIT_OBJECT_CONTENT', representation: 'GIT_BLOB_OBJECT_ID',
    subject: { kind: 'COMMITTED_BLOB', commit: ref, path }, gitObject: item.objectId, mode: item.mode };
}
export function gitObjectContentRecord(path, ref) {
  const data = gitBytes('show', ref + ':' + path);
  return { path, domain: 'GIT_OBJECT_CONTENT', representation: 'SHA256_GIT_OBJECT_CONTENT',
    subject: { kind: 'EXACT_GIT_SHOW_BYTES', ref, path }, sha256: rawBytesSha256(data), bytes: data.length };
}
export function compareGitObjects(startRecord, otherRecord) {
  assert.equal(startRecord.domain, 'GIT_OBJECT_CONTENT'); assert.equal(otherRecord.domain, 'GIT_OBJECT_CONTENT');
  assert.equal(startRecord.path, otherRecord.path); assert.equal(startRecord.representation, otherRecord.representation);
  assert.equal(startRecord.gitObject, otherRecord.gitObject, 'PROTECTED_GIT_OBJECT_CHANGED:' + startRecord.path);
  assert.equal(startRecord.mode, otherRecord.mode, 'PROTECTED_MODE_CHANGED:' + startRecord.path);
  return { path: startRecord.path, domain: 'GIT_OBJECT_CONTENT', representation: 'GIT_BLOB_OBJECT_ID',
    subject: { kind: 'START_VS_FREEZE_OR_RESULT_BLOB_COMPARISON', path: startRecord.path },
    startingGitObject: startRecord.gitObject, freezeOrResultGitObject: otherRecord.gitObject,
    startingSubject: startRecord.subject, freezeOrResultSubject: otherRecord.subject, equal: true };
}
export async function indexRecord(path) {
  assert.ok(path.startsWith(DIR + '/') || path.startsWith(OUT + '/'), 'INDEX_FREEZE_SCOPE');
  const b = gitBytes('show', ':' + path), local = await bytes(path);
  const s = b.toString(); assert.ok(!s.includes('\r') && (!s || s.endsWith('\n') && !s.endsWith('\n\n')), 'INDEX_LF_FORMAT:' + path);
  assert.ok(s.split('\n').every(l => !/[\t ]+$/.test(l)), 'INDEX_TRAILING_WHITESPACE:' + path);
  // New V36 controlled sources are deterministic LF; unlike protected historical files, these bytes must match the staged candidate.
  assert.equal(rawBytesSha256(local), rawBytesSha256(b), 'NEW_V36_INDEX_WORKTREE_DISAGREEMENT:' + path);
  const objectId = git('rev-parse', ':' + path);
  return { path, domain: 'GIT_OBJECT_CONTENT', representation: 'SHA256_GIT_OBJECT_CONTENT',
    subject: { kind: 'STAGED_INDEX_BLOB_CONTENT', path, stage: 0, indexGitObject: objectId }, sha256: rawBytesSha256(b), bytes: b.length };
}
export function verifyCommittedIndexRecord(record, ref) {
  assert.equal(record.domain, 'GIT_OBJECT_CONTENT'); assert.equal(record.subject.kind, 'STAGED_INDEX_BLOB_CONTENT');
  const committed = gitObjectContentRecord(record.path, ref);
  assert.equal(committed.sha256, record.sha256, 'COMMITTED_V36_INDEX_BYTES:' + record.path);
  return { ...committed, frozenIndexSHA256: record.sha256, indexMatchedCommit: true };
}
