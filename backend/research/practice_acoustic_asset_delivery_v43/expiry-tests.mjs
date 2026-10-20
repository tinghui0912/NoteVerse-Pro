import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OSS4_FIELDS, signedMetadata, validateSignedMetadata } from './oss-expiry.mjs';
import { scanText } from './security.mjs';
import { DIR } from './discovery.mjs';

export function expiryTests() {
  const tests = [], test = (name, fn) => { fn(); tests.push({ name, result: 'PASS' }); };
  const now = Date.parse('2030-01-02T03:04:05Z'), effective = now + 300000;
  const metadata = delta => ({ https: true, hostname: 'noteverse-model-assets.oss-cn-shenzhen.aliyuncs.com',
    pathname: '/models/continuous/robust-browser-v1/4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3/model.onnx',
    xOssDate: '20300102T030405Z', xOssExpires: '300', descriptorExpiry: new Date(effective + delta).toISOString(),
    signatureVersion: 'OSS4-HMAC-SHA256', oss4FieldPresence: Object.fromEntries(OSS4_FIELDS.map(k => [k, true])), awsSigningAbsent: true });
  for (const delta of [0, 500, 999, 1001, 1999]) test('directional delta ' + delta + ' accepted', () => assert.equal(validateSignedMetadata(metadata(delta), now).deltaMs, delta));
  test('1001 reproduces V42 false negative', () => { assert.equal(1001 < 1000, false); assert.equal(validateSignedMetadata(metadata(1001), now).deltaMs, 1001); });
  test('2000 rejected', () => assert.throws(() => validateSignedMetadata(metadata(2000), now)));
  test('descriptor earlier rejected', () => assert.throws(() => validateSignedMetadata(metadata(-1), now)));
  test('effective expiry expired rejected', () => assert.throws(() => validateSignedMetadata(metadata(1001), effective + 1)));
  test('descriptor expiry expired rejected', () => { const m = metadata(0); m.descriptorExpiry = new Date(now - 1).toISOString(); assert.throws(() => validateSignedMetadata(m, now)); });
  for (const date of ['invalid', '20300230T030405Z']) test('invalid signing date ' + date + ' rejected', () => assert.throws(() => validateSignedMetadata({ ...metadata(0), xOssDate: date }, now)));
  for (const ttl of ['not-numeric', '1.5', '0', '-1', '604801']) test('invalid duration ' + ttl + ' rejected', () => assert.throws(() => validateSignedMetadata({ ...metadata(0), xOssExpires: ttl }, now)));
  test('missing OSS4 field rejected', () => { const m = metadata(0); m.oss4FieldPresence['x-oss-signature'] = false; assert.throws(() => validateSignedMetadata(m, now)); });
  test('AWS signing rejected', () => assert.throws(() => validateSignedMetadata({ ...metadata(0), awsSigningAbsent: false }, now)));
  test('wrong host rejected', () => assert.throws(() => validateSignedMetadata({ ...metadata(0), hostname: 'other.invalid' }, now)));
  test('wrong path rejected', () => assert.throws(() => validateSignedMetadata({ ...metadata(0), pathname: '/other' }, now)));
  test('non HTTPS rejected', () => assert.throws(() => validateSignedMetadata({ ...metadata(0), https: false }, now)));
  test('sanitized parser never returns credential query values', () => {
    const m = metadata(1001), opaque = 'synthetic' + 'q'.repeat(48);
    const url = new URL('https://' + m.hostname + m.pathname);
    for (const [key, value] of Object.entries({ 'x-oss-signature-version': m.signatureVersion, 'x-oss-date': m.xOssDate,
      'x-oss-expires': m.xOssExpires, 'x-oss-signature': opaque, 'x-oss-credential': opaque })) url.searchParams.set(key, value);
    const safe = signedMetadata(url.href, m.descriptorExpiry), serialized = JSON.stringify(safe);
    assert.equal(serialized.includes(opaque), false); assert.equal(serialized.includes('?'), false);
    assert.equal(scanText(serialized, [opaque]).length, 0); assert.equal(validateSignedMetadata(safe, now).deltaMs, 1001);
  });
  test('browser uses shared directional parser without absolute difference', () => {
    const source = readFileSync(DIR + '/browser-entry.mjs', 'utf8');
    assert.ok(source.includes('validateSignedMetadata(metadata, receivedAtMs)'));
    assert.equal(source.includes('Math.abs'), false);
  });
  return { result: 'LOCAL_PASS_NOT_CI', tests };
}
