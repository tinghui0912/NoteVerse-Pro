import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { REQUIRED, START, gitBytes, verifyPaths, sha256 } from './discovery.mjs';
import { rawFileIdentity, canonicalIdentity } from './identities.mjs';
import { filesUnder } from './security.mjs';

export function staticProductProof() {
  const required = [...REQUIRED, 'apps/customer-web/package.json', 'apps/customer-web/package-lock.json', 'apps/customer-web/tsconfig.json'];
  const records = verifyPaths(args => gitBytes(...args), START, required);
  const source = suffix => gitBytes('show', START + ':' + required.find(p => p.endsWith(suffix))).toString();
  const route = source('/model_assets/router.py'), service = source('/model_assets/service.py'), store = source('/model-asset-store.ts');
  const facts = {
    sameOriginApi: source('/app-protocol.ts').includes("API_BASE_URL = '/api/v1'"),
    nextServerRewrite: source('/next.config.ts').includes('NEXT_BACKEND_ORIGIN'),
    credentialsInclude: /credentials:\s*['"]include['"]/.test(source('/api-client.ts')),
    authenticatedRoute: route.includes('Depends(get_current_user)'),
    activeDatabaseUser: source('/deps.py').includes('select(User).where(User.id == user_id)') && source('/deps.py').includes('if not user.is_active'),
    realServicePresign: service.includes('self.client.presign(') && service.includes('GetObjectRequest'),
    deliveryOnly: !/websocket|session\.run|PracticeRuntime|microphone/i.test(route + service),
    frontendIdentityAssertion: source('/practice-acoustic-model-asset.ts').includes('assertPracticeAcousticModelAccess(response.data)'),
    urlIndependentCacheKey: store.includes('`${descriptor.assetId.toLowerCase()}:${descriptor.sha256.toLowerCase()}`'),
    graphOptimizationDisabled: source('/model-inference.ts').includes("graphOptimizationLevel: 'disabled'")
  };
  for (const [name, value] of Object.entries(facts)) assert.equal(value, true, name);
  const cold = store.slice(store.indexOf('const downloadMs'), store.indexOf('private async tryReadCachedAsset'));
  const terms = ['binHandle.getFile()', 'file.arrayBuffer()', 'bytes.byteLength !== descriptor.expectedByteSize', 'computeSha256Hex(bytes)',
    'digest.toLowerCase() !== descriptor.sha256.toLowerCase()', "entryDir.getFileHandle('verified.json'"];
  const activationOrder = terms.map(term => ({ term, position: cold.indexOf(term) }));
  activationOrder.forEach((record, index) => { assert.ok(record.position >= 0); if (index) assert.ok(record.position > activationOrder[index - 1].position); });
  const inference = source('/model-inference.ts');
  const loaderOrder = ['await createVerifiedModelAssetLoader()(manifest.asset)', 'await verifyAcousticModel(loaded.bytes)', 'ort.InferenceSession.create(loaded.bytes']
    .map(term => ({ term, position: inference.indexOf(term) }));
  loaderOrder.forEach((record, index) => { assert.ok(record.position >= 0); if (index) assert.ok(record.position > loaderOrder[index - 1].position); });
  const ts = createRequire(path.resolve('apps/customer-web/package.json'))('typescript');
  const ast = ts.createSourceFile('model-asset-store.ts', store, ts.ScriptTarget.Latest, true), calls = [];
  const walk = node => { if (ts.isCallExpression(node) && /getFile|arrayBuffer|computeSha256Hex|createWritable/.test(node.expression.getText(ast))) calls.push({ expression: node.expression.getText(ast), start: node.pos, end: node.end }); ts.forEachChild(node, walk); };
  walk(ast);
  const core = 'apps/customer-web/src/lib/practice/acoustic/model/acoustic-core-identity.json';
  const definition = 'apps/customer-web/src/lib/practice/acoustic/model/model-contract.ts';
  const dual = { raw: rawFileIdentity(core), semantic: canonicalIdentity(core), definition: rawFileIdentity(definition) };
  assert.equal(dual.raw.sha256, 'ce05905ea023f9bb41a5c2d4e0fd6fb9c3bb7f3222af4a0f1b212257380bf2fb');
  assert.equal(dual.semantic.sha256, '93a9914278e3aa3d659ca73aec8ac10dde5bb51d2101a87abfadcbc75ed01443');
  assert.equal(dual.definition.sha256, 'dca6d9c5feda834f356f3243e500c8542d1b83a65c724de815cb068d72c57ad5');
  assert.notEqual(dual.raw.sha256, dual.semantic.sha256);
  return { records, facts, activationOrder, loaderOrder, astCallWitnesses: calls, dual, productCodeExecuted: false };
}
export function externalTreeIdentity(root, extensions) {
  const records = filesUnder(root).filter(file => extensions.some(ext => file.endsWith(ext))).sort()
    .map(file => { const bytes = readFileSync(file); return { path: path.relative(root, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha256(bytes) }; });
  return { subject: root, domain: 'EXTERNAL_LOCAL_ASSET', representation: 'SHA256_CANONICAL_SORTED_FILE_RECORDS', extensions,
    files: records.length, bytes: records.reduce((n, r) => n + r.bytes, 0), sha256: sha256(Buffer.from(JSON.stringify(records))) };
}
export function verifyExternal(record) {
  if (record.representation === 'SHA256_CANONICAL_SORTED_FILE_RECORDS') {
    const current = externalTreeIdentity(record.subject, record.extensions); assert.equal(current.sha256, record.sha256); return;
  }
  const current = rawFileIdentity(record.subject, record.domain); assert.equal(current.sha256, record.sha256); assert.equal(current.byteSize, record.byteSize);
}
