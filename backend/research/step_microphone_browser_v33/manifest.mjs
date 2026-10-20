import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { ROOT, DIR, OUT, V26, V26SRC, V27, START, bytes, load, git } from './io.mjs';
import { verifyWorktreeMaterialization, verifyExternalLocalAsset, verifyCanonicalJsonIdentity } from './identities.mjs';
import { gitTree, gitObjectRecord, gitObjectContentRecord } from './git-identities.mjs';
const corePath = 'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json';
const definitionPath = 'apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts';
export const acceptedRawArtifacts = [
  [V26 + '/bundles/entry.js', '94a042eb56bb6bea42521e65547cab632ab84b693379599a1d55dff4824fac35', 132684],
  [V26 + '/bundles/worker.js', 'fa72177cc90c3d91a7b48ef57225624cedd69e8dc232eb6bd8cc83ad502b0526', 33908],
  [V26 + '/browser-input.wav', '47e9287126bd2b0f1589abb972c98bac467c1850b2ad620a7b3604d26d9b316b', 3685040],
  [V26 + '/build-and-environment.json', '0d46a0b1a5b3ba4be3343ab99b6e07061d5600973c497eb093a755aba18e58d9'],
  [V26SRC + '/contract.json', 'f983c5f9f234b6ec13d2e1bd30696a20b4d922c89a70dd3104bbdc5976221056']
];
export const ownFiles = async () => (await readdir(path.join(ROOT, DIR))).map(p => DIR + '/' + p).sort();
export async function rawImmutable() {
  const tree = gitTree(START), localRecord = (p, hash, count) => tree.has(p)
    ? verifyWorktreeMaterialization(p, hash, count) : verifyExternalLocalAsset(p, hash, count);
  const artifacts = []; for (const a of acceptedRawArtifacts) artifacts.push(await verifyWorktreeMaterialization(...a));
  const oldPath = V27 + '/browser-protocol-freeze.json';
  const oldFreezeIdentity = await verifyWorktreeMaterialization(oldPath, 'c3a253f8cb8a7d0e5a79b3d6e67fc60975dec0511014d71485b9d4f9054e8e1e');
  const old = await load(oldPath), build = await load(V26 + '/build-and-environment.json'), sourceInputs = [], virtual = new Set();
  for (const bundle of build.bundles) for (const name of bundle.inputs) {
    if (name === '<define:process.env>') { virtual.add(name); continue; }
    assert.ok(!name.startsWith('<') && !name.endsWith('>'), 'UNKNOWN_VIRTUAL_INPUT');
    const f = old.immutableCandidate.filesystemInputs.find(f => f.metafileInputName === name);
    assert.ok(f, 'UNREPRESENTED_FILESYSTEM_INPUT:' + name);
    sourceInputs.push({ metafileInputName: name, ...await localRecord(f.path, f.sha256, f.bytes) });
  }
  assert.deepEqual([...virtual], ['<define:process.env>']);
  const frozenLocalSourceIdentities = [];
  for (const f of old.files) frozenLocalSourceIdentities.push(await localRecord(f.path, f.sha256));
  const assets = []; for (const [route, a] of Object.entries(build.assets)) assets.push({ route, ...await localRecord(a.path, a.sha256, a.bytes) });
  const coreRaw = await verifyWorktreeMaterialization(corePath, 'ce05905ea023f9bb41a5c2d4e0fd6fb9c3bb7f3222af4a0f1b212257380bf2fb');
  const productionCanonicalDefinition = await verifyWorktreeMaterialization(definitionPath, 'dca6d9c5feda834f356f3243e500c8542d1b83a65c724de815cb068d72c57ad5');
  const ortPackage = await localRecord('apps/customer-web/node_modules/onnxruntime-web/package.json');
  assert.equal((await load(ortPackage.path)).version, '1.20.1');
  const environment = build.environment;
  const chrome = { executable: environment.chromeExecutable, ...await verifyExternalLocalAsset(environment.chromeExecutable, environment.chromeExecutableSha256),
    staticFileVersion: environment.chromeFileVersion, versionProvenance: 'Exact executable local asset SHA bound to V26 FileVersionInfo; browser version independently checked after authorization' };
  assert.equal(chrome.staticFileVersion, '155.0.8059.80');
  const playwrightPath = 'backend/research/browser_runtime/dr3r_browser_runtime/node_modules/playwright';
  const playwrightPackage = await localRecord(playwrightPath + '/package.json');
  assert.equal((await load(playwrightPackage.path)).version, '1.48.2');
  const apiClientLocal = await verifyWorktreeMaterialization('apps/customer-web/src/lib/api-client.ts', '2b08bd76661e769eec0cdb8d632741e05baca4e476ae5905d3e24a1c2c36162a', 12330);
  const apiClientGit = gitObjectRecord(apiClientLocal.path, START, tree), apiClientContent = gitObjectContentRecord(apiClientLocal.path, START);
  assert.equal(apiClientGit.gitObject, '5e9b70b14e172548facd6835c744f6d9dba18af2');
  assert.equal(apiClientContent.sha256, '2ab48f9af86dbd700fae94b42794839c9c029aac44e8f88b2dc9cd4f9e4adc06');
  const virtualInputs = old.immutableCandidate.virtualInputs.map(v => ({ domain: 'ESBUILD_VIRTUAL_INPUT', representation: 'SEMANTIC_BUILD_NODE',
    subject: { kind: 'ESBUILD_DEFINE_NODE', identifier: v.identifier, bundles: v.bundles }, identifier: v.identifier,
    semanticProvenance: v.provenance, historicalBuildSemanticDigest: { domain: 'CANONICAL_JSON_SEMANTIC_IDENTITY', representation: 'CANONICAL_JSON_UTF8_SHA256',
      subject: { kind: 'HISTORICAL_BUILD_SEMANTIC_RECORD', source: oldPath }, sha256: v.buildSemanticRecordSha256 }, filesystemReadAttempted: false }));
  return { artifacts, assets, sourceInputs, frozenLocalSourceIdentities, coreRaw, productionCanonicalDefinition, chrome,
    playwright: { path: playwrightPath, version: '1.48.2', packageIdentity: playwrightPackage }, ortPackage,
    virtualInputs, oldFreezeIdentity, bundleRebuilds: 0, apiClient: { local: apiClientLocal, git: apiClientGit, gitContent: apiClientContent,
      domainsDifferExpected: true, notADriftComparison: true },
    browserEnvironment: { chromeExecutable: environment.chromeExecutable, chromeExecutableSha256: environment.chromeExecutableSha256,
      chromeFileVersion: environment.chromeFileVersion, executableIdentity: chrome },
    buildSemantics: { platform: 'browser', format: 'esm', target: 'es2022', bundle: true, metafile: true,
      define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, externalResolver: 'onnxruntime-web/webgpu -> /ort/ort.webgpu.min.mjs',
      nodePaths: ['apps/customer-web/node_modules'], provenanceSource: oldFreezeIdentity } };
}
export async function semanticCoreIdentity() {
  const raw = await verifyWorktreeMaterialization(corePath, 'ce05905ea023f9bb41a5c2d4e0fd6fb9c3bb7f3222af4a0f1b212257380bf2fb');
  const productionDefinition = await verifyWorktreeMaterialization(definitionPath, 'dca6d9c5feda834f356f3243e500c8542d1b83a65c724de815cb068d72c57ad5');
  const canonical = await verifyCanonicalJsonIdentity(corePath, '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443');
  assert.notEqual(raw.representation, canonical.representation); assert.notEqual(raw.sha256, canonical.sha256, 'EXPECTED_RAW_CANONICAL_INEQUALITY');
  return { raw, productionDefinition, canonical, expectedRepresentationsAndHashesDiffer: true, productionAcousticCodeExecuted: false };
}
export const immutable = async () => ({ ...await rawImmutable(), core: await semanticCoreIdentity() });
export async function environmentPolicy() {
  const configPath = path.resolve(ROOT, git('rev-parse', '--git-path', 'config'));
  return { repositoryConfig: await verifyExternalLocalAsset(configPath),
    coreAutocrlfReadOnly: git('config', '--get', 'core.autocrlf'), configNeverWrittenByTooling: true };
}
export async function textFormatting() {
  const reports = await readdir(path.join(ROOT, OUT)).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  const files = [...await ownFiles(), ...reports.filter(p => /\.(json|md|log|mjs)$/.test(p)).map(p => OUT + '/' + p)];
  for (const p of files) {
    const s = (await bytes(p)).toString(); assert.ok(!s.includes('\r'), 'NEW_V33_TEXT_CRLF:' + p);
    assert.ok(!s || s.endsWith('\n') && !s.endsWith('\n\n'), 'NEW_V33_TEXT_EOF:' + p);
    assert.ok(s.split('\n').every(l => !/[\t ]+$/.test(l)), 'NEW_V33_TRAILING_WHITESPACE:' + p);
  }
  return { files: files.length, newline: 'LF_SINGLE_FINAL_NEWLINE_OR_EMPTY_LOG', protectedMaterializationsNeverNormalized: true };
}
