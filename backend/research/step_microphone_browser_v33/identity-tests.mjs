import assert from 'node:assert/strict';
import { RAW, CANONICAL, canonicalJson, canonicalJsonSha256, verifyWorktreeMaterialization, verifyCanonicalJsonIdentity, verifyExternalLocalAsset } from './identities.mjs';
import { rawBytesSha256 } from './io.mjs';
import { compareGitObjects } from './git-identities.mjs';
export async function identityTests() {
  const results = [], test = async (name, run) => { await run(); results.push({ name, result: 'LOCAL_PASS_SYNTHETIC_ONLY' }); };
  await test('key sorting recursively and raw whitespace independent of semantic identity', () => {
    assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
    const a = Buffer.from('{"a":1}'), b = Buffer.from(' { "a" : 1 }\n');
    assert.notEqual(rawBytesSha256(a), rawBytesSha256(b)); assert.equal(canonicalJsonSha256(JSON.parse(a)), canonicalJsonSha256(JSON.parse(b)));
  });
  await test('arrays preserve order and primitive serializations remain distinct', () => {
    assert.notEqual(canonicalJsonSha256([1, 2]), canonicalJsonSha256([2, 1]));
    const values = [null, false, true, 0, 1, '0', '']; assert.equal(new Set(values.map(canonicalJsonSha256)).size, values.length);
    for (const value of values) assert.equal(canonicalJson(value), JSON.stringify(value));
  });
  await test('worktree, external asset, canonical semantic records always name domain representation and subject', async () => {
    const b = Buffer.from(' {"b":2,"a":1}\n'), read = async () => b;
    const raw = await verifyWorktreeMaterialization('fixture.json', rawBytesSha256(b), b.length, read);
    const semantic = await verifyCanonicalJsonIdentity('fixture.json', canonicalJsonSha256(JSON.parse(b)), read);
    const external = await verifyExternalLocalAsset('fixture.bin', rawBytesSha256(b), b.length, read);
    assert.equal(raw.representation, RAW); assert.equal(semantic.representation, CANONICAL); assert.notEqual(raw.sha256, semantic.sha256);
    assert.equal(external.domain, 'EXTERNAL_LOCAL_ASSET');
    for (const r of [raw, semantic, external]) assert.ok(r.subject && r.representation && r.domain);
  });
  await test('incorrect expected local raw and canonical hashes fail exactly', async () => {
    const read = async () => Buffer.from('{"a":1}');
    await assert.rejects(verifyWorktreeMaterialization('fixture', '0'.repeat(64), undefined, read), /WORKTREE_MATERIALIZATION/);
    await assert.rejects(verifyCanonicalJsonIdentity('fixture', '0'.repeat(64), read), /CANONICAL_JSON/);
  });
  await test('Git immutability compares Git object domains only and rejects mutation', () => {
    const r = { path: 'fixture', domain: 'GIT_OBJECT_CONTENT', representation: 'GIT_BLOB_OBJECT_ID', gitObject: 'a', mode: '100644' };
    assert.equal(compareGitObjects(r, { ...r }).equal, true);
    assert.throws(() => compareGitObjects(r, { ...r, gitObject: 'b' }));
    assert.throws(() => compareGitObjects(r, { ...r, domain: 'WORKTREE_MATERIALIZATION' }));
  });
  await test('different checkout bytes may coexist with identical committed content without drift', () => {
    const lf = Buffer.from('a\nb\n'), crlf = Buffer.from('a\r\nb\r\n');
    assert.notEqual(rawBytesSha256(lf), rawBytesSha256(crlf));
    const a = { path: 'fixture', domain: 'GIT_OBJECT_CONTENT', representation: 'GIT_BLOB_OBJECT_ID', gitObject: 'same', mode: '100644' };
    assert.equal(compareGitObjects(a, { ...a }).equal, true);
  });
  return results;
}
