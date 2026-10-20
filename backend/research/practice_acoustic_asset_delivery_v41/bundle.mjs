import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DIR, sha256 } from './discovery.mjs';
import { rawFileIdentity } from './identities.mjs';
import { scanText } from './security.mjs';

export async function constructBundle(secrets = []) {
  const app = path.resolve('apps/customer-web'), require = createRequire(path.join(app, 'package.json'));
  const lock = JSON.parse(readFileSync(path.join(app, 'package-lock.json')));
  const manifest = JSON.parse(readFileSync(path.join(app, 'package.json')));
  const vitePackage = require.resolve('vite/package.json'), viteEntry = require.resolve('vite');
  const viteInfo = JSON.parse(readFileSync(vitePackage));
  assert.equal(viteInfo.version, lock.packages['node_modules/vite'].version);
  assert.ok(lock.packages['node_modules/vitest'].dependencies.vite);
  assert.equal(manifest.dependencies?.esbuild ?? manifest.devDependencies?.esbuild, undefined);
  const vite = await import(pathToFileURL(viteEntry).href); assert.equal(typeof vite.build, 'function');
  const inputFiles = new Map(), virtual = new Set();
  const route = '/__v41/ort/ort.webgpu.min.mjs';
  const allowedVirtual = new Set(['\0vite/preload-helper.js', '\0vite/modulepreload-polyfill.js']);
  const buildOnce = async () => {
    const result = await vite.build({ root: app, configFile: false, envFile: false, envDir: false,
      mode: 'production', logLevel: 'silent', publicDir: false,
      resolve: { alias: { '@': path.join(app, 'src') } },
      define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
      plugins: [{ name: 'v41-frozen-input-provenance', enforce: 'pre',
        resolveId(id) { if (id === 'onnxruntime-web/webgpu') return { id: route, external: true }; },
        load(id) {
          if (id.startsWith('\0')) { assert.ok(allowedVirtual.has(id), 'UNKNOWN_BUNDLER_VIRTUAL_INPUT'); virtual.add(id); return; }
          assert.equal(id.includes('?'), false, 'UNFROZEN_QUERY_INPUT');
          if (path.isAbsolute(id)) {
            const relative = path.relative(process.cwd(), id).replaceAll('\\', '/');
            assert.ok(relative.startsWith('apps/customer-web/src/') || relative.startsWith('apps/customer-web/node_modules/') || relative.startsWith(DIR + '/'), 'UNEXPECTED_BUNDLE_SUBJECT');
            const record = rawFileIdentity(relative, relative.includes('/node_modules/') ? 'EXTERNAL_LOCAL_ASSET' : 'WORKTREE_MATERIALIZATION');
            if (inputFiles.has(relative)) assert.equal(inputFiles.get(relative).sha256, record.sha256);
            inputFiles.set(relative, record);
          }
        } }],
      build: { write: false, minify: false, target: 'es2022', sourcemap: false, copyPublicDir: false,
        lib: { entry: path.resolve(DIR, 'browser-entry.mjs'), formats: ['es'], fileName: () => 'entry.mjs' },
        rolldownOptions: { external: [route], output: { format: 'es', inlineDynamicImports: true, entryFileNames: 'entry.mjs' } } }
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(value => value.output ?? []);
    assert.equal(outputs.length, 1, 'SINGLE_FROZEN_ESM_ENTRY_REQUIRED'); assert.equal(outputs[0].type, 'chunk');
    return outputs[0];
  };
  const first = await buildOnce(), second = await buildOnce();
  assert.equal(sha256(Buffer.from(first.code)), sha256(Buffer.from(second.code)), 'NONDETERMINISTIC_BUNDLE');
  assert.equal(scanText(first.code, secrets).length, 0, 'BUNDLE_SECRET_SCAN_FAILED');
  const ts = require('typescript'), ast = ts.createSourceFile('entry.mjs', first.code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, 'BUNDLE_PARSE_FAILED');
  const imports = ast.statements.filter(node => ts.isImportDeclaration(node)).map(node => node.moduleSpecifier.text);
  assert.deepEqual([...new Set(imports)], [route]);
  assert.ok(first.code.includes('getPracticeAcousticModelAccess') && first.code.includes('AcousticModelSession') && first.code.includes('ModelAssetStore'));
  assert.equal(first.code.includes('node:'), false, 'NODE_IMPORT_IN_BROWSER_BUNDLE');
  const modules = Object.keys(first.modules);
  assert.ok(modules.some(name => name.endsWith('/model-inference.ts')) && modules.some(name => name.endsWith('/practice-acoustic-model-asset.ts')));
  return { code: first.code, record: { authority: 'CUSTOMER_WEB_LOCKFILE_VITEST_VITE_BUILD_API', documentation: 'https://vite.dev/guide/api-javascript.html#build',
    viteVersion: viteInfo.version, vitePackage: rawFileIdentity(vitePackage, 'EXTERNAL_LOCAL_ASSET'),
    viteEntry: rawFileIdentity(viteEntry, 'EXTERNAL_LOCAL_ASSET'), externalRoute: route,
    options: { format: 'es', target: 'es2022', configFile: false, envDir: false, publicDir: false, write: false, noApiOrOssMock: true },
    inputs: [...inputFiles.values()], virtualInputs: [...virtual].map(id => ({ subject: id, domain: 'BUNDLER_VIRTUAL_INPUT', representation: 'VITE_BUILD_SEMANTICS', provenance: 'Vite library build; explicit allowlist; not a filesystem path' })),
    bundleSha256: sha256(Buffer.from(first.code)), byteSize: Buffer.byteLength(first.code), structuralSmoke: { result: 'PASS', syntax: 'ECMASCRIPT_MODULE_AST', imports, sameBytesFromTwoIndependentBuildCalls: true, productRuntimeExecuted: false } } };
}
