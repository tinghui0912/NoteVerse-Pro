import assert from 'node:assert/strict';
import { RAW, CANONICAL, canonicalJson, canonicalJsonSha256, rawFileSha256, verifyRawFileIdentity, verifyCanonicalJsonIdentity } from './identities.mjs';
import { rawBytesSha256 } from './io.mjs';

export async function identityTests() {
  const results = [], test = async (name, run) => { await run(); results.push({ name, result: 'LOCAL_PASS_SYNTHETIC_ONLY' }); };
  await test('object keys sort recursively independent of insertion order', () => {
    assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
    assert.equal(canonicalJsonSha256({ b: 2, a: 1 }), canonicalJsonSha256({ a: 1, b: 2 }));
  });
  await test('raw whitespace changes raw bytes but not parsed canonical semantic identity', () => {
    const a = Buffer.from('{"a":1}'), b = Buffer.from(' { "a" : 1 }\n');
    assert.notEqual(rawBytesSha256(a), rawBytesSha256(b));
    assert.equal(canonicalJsonSha256(JSON.parse(a)), canonicalJsonSha256(JSON.parse(b)));
  });
  await test('array order is preserved', () => {
    assert.equal(canonicalJson([2, 1]), '[2,1]'); assert.notEqual(canonicalJsonSha256([1, 2]), canonicalJsonSha256([2, 1]));
  });
  await test('JSON primitives retain distinct serialization', () => {
    const values = [null, false, true, 0, 1, '0', ''];
    assert.equal(new Set(values.map(canonicalJsonSha256)).size, values.length);
    for (const value of values) assert.equal(canonicalJson(value), JSON.stringify(value));
  });
  await test('raw and canonical records have distinct representations and may intentionally differ', async () => {
    const b = Buffer.from(' {"b": 2, "a": 1}\n'), read = async () => b;
    const raw = await verifyRawFileIdentity('synthetic.json', rawBytesSha256(b), b.length, read);
    const semantic = await verifyCanonicalJsonIdentity('synthetic.json', canonicalJsonSha256(JSON.parse(b)), read);
    assert.equal(raw.representation, RAW); assert.equal(semantic.representation, CANONICAL);
    assert.notEqual(raw.representation, semantic.representation); assert.notEqual(raw.sha256, semantic.sha256);
    assert.equal(await rawFileSha256('synthetic.json', read), raw.sha256);
  });
  await test('incorrect expected RAW hash fails without normalization', async () => {
    await assert.rejects(verifyRawFileIdentity('synthetic.json', '0'.repeat(64), undefined, async () => Buffer.from('{"a":1}')), /RAW_FILE_BYTES_SHA256/);
  });
  await test('incorrect expected CANONICAL hash fails without tolerance', async () => {
    await assert.rejects(verifyCanonicalJsonIdentity('synthetic.json', '0'.repeat(64), async () => Buffer.from('{"a":1}')), /CANONICAL_JSON_UTF8_SHA256/);
  });
  return results;
}
