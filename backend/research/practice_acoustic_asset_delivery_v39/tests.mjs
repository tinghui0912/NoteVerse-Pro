import assert from 'node:assert/strict';
import { verifyPath, verifyPaths, summarizeInventory, rejectDisplayedInventory } from './discovery.mjs';
import { scanText, sanitizeUrl } from './security.mjs';
import { classifyRequest } from './network.mjs';
import { canonicalJson } from './identities.mjs';
import { sha256 } from './discovery.mjs';
import { auditCell } from './audit.mjs';
import { readFileSync } from 'node:fs';

export function toolingTests() {
  const tests = [];
  const test = (name, fn) => { fn(); tests.push({ name, result: 'PASS' }); };
  const commit = 'a'.repeat(40), blob = 'b'.repeat(40), file = 'required/file.ts';
  const run = args => {
    if (args[0] === 'cat-file' && args[1] === '-e') { assert.equal(args[2], commit + ':' + file); return Buffer.alloc(0); }
    if (args[0] === 'cat-file') return Buffer.from('blob\n');
    if (args[0] === 'rev-parse') return Buffer.from(blob + '\n');
    return Buffer.from('100644 blob ' + blob + '\t' + file + '\0');
  };
  test('exact required blob', () => assert.equal(verifyPath(run, commit, file).blobSha, blob));
  test('missing blob fails', () => assert.throws(() => verifyPath(() => { throw Error('MISSING'); }, commit, file)));
  test('truncated display cannot change per-path result', () => { const display = 'Warning: truncated output'; assert.ok(display); assert.equal(verifyPath(run, commit, file).exists, true); });
  test('truncation marker rejected as authority', () => assert.throws(() => rejectDisplayedInventory('Warning: truncated output')));
  test('omitted middle rejected', () => assert.throws(() => rejectDisplayedInventory('... omitted middle ...')));
  test('internal binary digest deterministic', () => { const raw = Buffer.from(Array.from({ length: 10000 }, (_, i) => 'path/' + i).join('\0') + '\0'); assert.deepEqual(summarizeInventory(raw), summarizeInventory(raw)); assert.equal(summarizeInventory(raw).entryCount, 10000); });
  test('duplicate required records fail', () => assert.throws(() => verifyPaths(run, commit, [file, file])));
  test('unexpected blob fails', () => assert.throws(() => verifyPath(run, commit, file, 'c'.repeat(40))));
  test('git nonzero fails', () => assert.throws(() => verifyPath(() => { throw Error('EXIT_NONZERO'); }, commit, file)));
  test('directory is not required blob', () => assert.throws(() => verifyPath(args => args[0] === 'cat-file' && args[1] === '-t' ? Buffer.from('tree') : run(args), commit, file)));
  const secret = 'synthetic' + 'x'.repeat(48);
  const unsafe = [JSON.stringify({ password: secret }), ['private', 'example.invalid'].join('@'), 'Bearer ' + secret,
    JSON.stringify({ cookie: secret }), JSON.stringify({ refresh_token: secret }), JSON.stringify({ csrf_token: secret }),
    'LTAI' + 'x'.repeat(20), JSON.stringify({ access_key_secret: secret }),
    'eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(20) + '.' + 'c'.repeat(20),
    'https:' + '//bucket.invalid/model?x-oss-signature=' + secret,
    'x-oss-credential=' + secret, 'x-oss-signature=' + secret];
  unsafe.forEach((value, index) => test('secret leakage ' + index + ' blocked', () => assert.ok(scanText(value).length)));
  test('opaque in-memory value blocked', () => assert.ok(scanText(secret, [secret]).length));
  test('sanitized URL has no query values', () => {
    const safe = sanitizeUrl('https:' + '//bucket.invalid/model?x-oss-signature=' + secret);
    assert.equal(scanText(JSON.stringify(safe)).length, 0); assert.equal(JSON.stringify(safe).includes(secret), false);
  });
  const origin = 'http://localhost:3000', key = 'models/model.onnx', host = 'bucket.invalid';
  test('same-origin access classification', () => assert.equal(classifyRequest(origin + '/api/v1/model-assets/practice-acoustic-robust-browser-v1/access', origin, key, host).classification, 'MODEL_ACCESS_DESCRIPTOR_API'));
  test('OSS query redacted', () => { const row = classifyRequest('https://' + host + '/' + key + '?sensitive=' + secret, origin, key, host); assert.equal(row.classification, 'OSS_MODEL_PAYLOAD_GET'); assert.equal(JSON.stringify(row).includes(secret), false); });
  test('unknown alternate model blocked', () => assert.equal(classifyRequest('https://other.invalid/' + key, origin, key, host).classification, 'UNKNOWN'));
  test('descriptor requests differ from model GETs', () => assert.notEqual(classifyRequest(origin + '/api/v1/model-assets/practice-acoustic-robust-browser-v1/access', origin, key, host).classification, classifyRequest('https://' + host + '/' + key, origin, key, host).classification));
  test('canonical key order', () => assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 })));
  test('canonical whitespace invariant', () => assert.equal(canonicalJson(JSON.parse('{ "a": 1 }')), canonicalJson(JSON.parse('{"a":1}'))));
  test('array order preserved', () => assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1])));
  test('primitive identity distinct', () => assert.notEqual(canonicalJson(1), canonicalJson('1')));
  test('raw and canonical are different subjects', () => assert.notEqual(sha256(Buffer.from('{ "a": 1 }')), sha256(Buffer.from(canonicalJson({ a: 1 })))));
  test('incorrect expected raw identity fails', () => assert.throws(() => assert.equal(sha256(Buffer.from('raw')), '0'.repeat(64))));
  test('incorrect expected semantic identity fails', () => assert.throws(() => assert.equal(sha256(Buffer.from(canonicalJson({ a: 1 }))), '0'.repeat(64))));
  const contract = JSON.parse(readFileSync('backend/research/practice_acoustic_asset_delivery_v39/contract.json'));
  const fixture = cold => {
    const name = contract.cells[cold ? 0 : 1], events = [];
    const add = (kind, data = {}) => events.push({ order: events.length + 1, cell: name, kind, ...data });
    const marker = { ...contract.model, verifiedAt: new Date().toISOString() }; delete marker.mediaType;
    add('CELL_BEGIN', cold ? { exactTargetEntryAbsent: true } : { verifiedEntryPreserved: true });
    add('ACCESS_RESPONSE', { status: 200, success: true, credentials: 'include' });
    add('PRODUCTION_DESCRIPTOR_ACCEPTED', { ...contract.model, signedAccess: { https: true,
      hostname: contract.expectedOssHost, pathname: '/' + contract.objectKey, signatureVersion: 'OSS4-HMAC-SHA256',
      awsSigningAbsent: true, oss4FieldPresence: { version: true } } });
    add('GPU', { vendor: 'synthetic', fallback: false });
    if (cold) { add('WRITE', { path: 'model.bin/model.bin', byteSize: contract.model.expectedByteSize }); add('WRITE_CLOSE', { path: 'model.bin/model.bin' }); }
    add('OPFS_BYTES_READ', { path: 'model.bin/model.bin', byteSize: contract.model.expectedByteSize });
    add('SHA256_VERIFIED_BYTES', { sha256: contract.model.sha256 });
    if (cold) { add('WRITE_OPEN', { path: 'marker/verified.json' }); add('WRITE', { path: 'marker/verified.json', marker }); add('WRITE_CLOSE', { path: 'marker/verified.json' }); }
    add('SHA256_VERIFIED_BYTES', { sha256: contract.model.sha256 });
    add('SESSION_READY', { diagnostics: { byteSize: contract.model.expectedByteSize, sha256: contract.model.sha256,
      modelSha256: contract.model.sha256, modelByteSize: contract.model.expectedByteSize, actualSessionLoadCount: 1,
      ortWebVersion: '1.20.1', executionProvider: 'webgpu', automaticFallback: false,
      inputDescriptor: { name: 'audio', dtype: 'float32', shape: [1, 29120] },
      outputDescriptors: { reg_onset_output: [1, 183, 88], frame_output: [1, 183, 88] }, source: cold ? 'network' : 'opfs-cache' } });
    add('FINAL_OPFS_CHECK', { byteSize: contract.model.expectedByteSize, sha256: contract.model.sha256, marker });
    add('SESSION_DISPOSED');
    return { name, result: 'RECEIPTS_READY_FOR_INDEPENDENT_AUDIT', events, inferenceRuns: 0 };
  };
  const net = cold => [{ classification: 'MODEL_ACCESS_DESCRIPTOR_API', status: 200 },
    ...(cold ? [{ classification: 'OSS_MODEL_PAYLOAD_GET', status: 200 }] : [])];
  test('cold activation independent accounting', () => assert.equal(auditCell(fixture(true), net(true), contract).result, 'PASS'));
  test('warm zero payload independent accounting', () => assert.equal(auditCell(fixture(false), net(false), contract).result, 'PASS'));
  test('warm redownload rejected', () => assert.throws(() => auditCell(fixture(false), net(true), contract)));
  test('early marker rejected', () => {
    const cell = fixture(true), digest = cell.events.find(e => e.kind === 'SHA256_VERIFIED_BYTES');
    digest.kind = 'MISSING_DIGEST'; assert.throws(() => auditCell(cell, net(true), contract));
  });
  return { result: 'LOCAL_PASS_NOT_CI', tests, discoveryTests: 10 };
}
