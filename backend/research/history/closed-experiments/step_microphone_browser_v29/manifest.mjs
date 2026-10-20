import assert from 'node:assert/strict';
import { ROOT, DIR, OUT, V26, V26SRC, V27, bytes, load, sha, canonical } from './io.mjs';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
export const accepted = [
  [V26 + '/bundles/entry.js', '94a042eb56bb6bea42521e65547cab632ab84b693379599a1d55dff4824fac35', 132684],
  [V26 + '/bundles/worker.js', 'fa72177cc90c3d91a7b48ef57225624cedd69e8dc232eb6bd8cc83ad502b0526', 33908],
  [V26 + '/browser-input.wav', '47e9287126bd2b0f1589abb972c98bac467c1850b2ad620a7b3604d26d9b316b', 3685040],
  [V26 + '/build-and-environment.json', '0d46a0b1a5b3ba4be3343ab99b6e07061d5600973c497eb093a755aba18e58d9'],
  [V26SRC + '/contract.json', 'f983c5f9f234b6ec13d2e1bd30696a20b4d922c89a70dd3104bbdc5976221056']
];
export async function ownFiles() { return (await readdir(path.join(ROOT, DIR))).map(p => DIR + '/' + p).sort(); }
export async function identity(p, expected, size) {
  const b = await bytes(p); if (expected) assert.equal(sha(b), expected, 'IMMUTABLE_SHA:' + p);
  if (size !== undefined) assert.equal(b.length, size, 'IMMUTABLE_BYTES:' + p);
  return { path: p, sha256: sha(b), bytes: b.length };
}
export async function immutable() {
  const artifacts = []; for (const a of accepted) artifacts.push(await identity(...a));
  const oldPath = V27 + '/browser-protocol-freeze.json';
  await identity(oldPath, 'c3a253f8cb8a7d0e5a79b3d6e67fc60975dec0511014d71485b9d4f9054e8e1e');
  const old = await load(oldPath), build = await load(V26 + '/build-and-environment.json');
  const sourceInputs = [], virtual = new Set();
  for (const bundle of build.bundles) for (const name of bundle.inputs) {
    if (name === '<define:process.env>') { virtual.add(name); continue; }
    assert.ok(!name.startsWith('<') && !name.endsWith('>'), 'UNKNOWN_VIRTUAL_INPUT');
    const f = old.immutableCandidate.filesystemInputs.find(f => f.metafileInputName === name);
    assert.ok(f, 'UNREPRESENTED_INPUT:' + name); sourceInputs.push({ metafileInputName: name, ...await identity(f.path, f.sha256, f.bytes) });
  }
  assert.deepEqual([...virtual], ['<define:process.env>']);
  for (const f of old.files) await identity(f.path, f.sha256);
  const assets = []; for (const [route, a] of Object.entries(build.assets)) assets.push({ route, ...await identity(a.path, a.sha256, a.bytes) });
  const core = await identity('apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json', '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443');
  assert.equal((await load('apps/customer-web/node_modules/onnxruntime-web/package.json')).version, '1.20.1');
  const environment = build.environment;
  const chrome = { executable: environment.chromeExecutable, ...await identity(environment.chromeExecutable, environment.chromeExecutableSha256),
    staticFileVersion: environment.chromeFileVersion, versionProvenance: 'Exact executable SHA bound to accepted V26 FileVersionInfo; no browser process before proof' };
  assert.equal(chrome.staticFileVersion, '155.0.8059.80');
  const playwrightPath = 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright';
  assert.equal((await load(playwrightPath + '/package.json')).version, '1.48.2');
  return { artifacts, build, assets, sourceInputs, core, chrome, playwright: { path: playwrightPath, version: '1.48.2' },
    virtualInputs: old.immutableCandidate.virtualInputs, buildSemantics: old.immutableCandidate.semantics,
    oldFreeze: { path: oldPath, sha256: sha(await bytes(oldPath)), frozenFilesReverified: old.files.length }, bundleRebuilds: 0 };
}
export async function textFormatting() {
  const reportNames = await readdir(path.join(ROOT, OUT)).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const files = [...await ownFiles(), ...reportNames.filter(p => /\.(json|md|log|mjs)$/.test(p)).map(p => OUT + '/' + p)];
  for (const p of files) {
    const s = (await bytes(p)).toString(); assert.ok(!s.includes('\r'), 'TEXT_CRLF:' + p);
    assert.ok(s.endsWith('\n') && !s.endsWith('\n\n'), 'TEXT_EOF:' + p);
    assert.ok(s.split('\n').every(l => !/[\t ]+$/.test(l)), 'TEXT_TRAILING_WHITESPACE:' + p);
  }
  return { files: files.length, newline: 'LF_SINGLE_FINAL_NEWLINE', identitiesDigestMeaning: 'Byte hashes, not normalized comparison' };
}
export const digest = v => sha(Buffer.from(canonical(v)));
