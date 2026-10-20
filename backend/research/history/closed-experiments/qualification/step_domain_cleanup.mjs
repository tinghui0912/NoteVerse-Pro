import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const revision = '9c97dfb021cb98930e71391a6e203d9ef176bd75';
const root = 'backend/research/history/step-original-bytedance-low-level-before-domain-reset';
const git = (...args) => execFileSync('git', args);
const tree = git('ls-tree', '-r', '--name-only', revision, 'apps/customer-web/src/lib/practice/acoustic-inference').toString().trim().split('\n');
const files = [...tree, ...[
  'local-core/step-evidence-session.ts', 'local-core/step-runtime.ts', 'local-core/evidence.ts',
  'local-core/session.ts', 'local-core/local-practice-core.test.ts', 'midi/browser-midi-controller.ts',
].map(p => 'apps/customer-web/src/lib/practice/' + p),
  'apps/customer-web/src/hooks/practice/use-step-local-practice.ts',
  'apps/customer-web/scripts/generate-bytedance-reference-contract-fixture.mjs'];
mkdirSync(root, { recursive: true });
writeFileSync(root + '/.gitattributes', '* -text\n');
const manifest = files.map(originalPath => {
  const bytes = git('show', `${revision}:${originalPath}`), archivedPath = `${root}/${originalPath}`;
  mkdirSync(path.dirname(archivedPath), { recursive: true }); writeFileSync(archivedPath, bytes);
  return { originalPath, path: archivedPath, sourceCommit: revision,
    gitBlob: git('rev-parse', `${revision}:${originalPath}`).toString().trim(), bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
});
writeFileSync(root + '/manifest.json', JSON.stringify({ sourceCommit: revision, files: manifest }, null, 2) + '\n');
for (const p of [...tree, files.at(-1), 'apps/customer-web/src/lib/practice/local-core/step-evidence-session.ts']) if (existsSync(p)) unlinkSync(p);
const from = 'backend/tests/test_continuous_model_asset.py', to = 'backend/tests/test_practice_acoustic_model_asset.py';
if (existsSync(from)) renameSync(from, to);
writeFileSync(to, readFileSync(to, 'utf8').replaceAll('ContinuousModelAssetTests', 'PracticeAcousticModelAssetTests'));
const testFrom = 'apps/customer-web/src/lib/api/continuous-model-asset.test.ts';
if (existsSync(testFrom)) renameSync(testFrom, 'apps/customer-web/src/lib/api/practice-acoustic-model-identity.test.ts');
const testTo = 'apps/customer-web/src/lib/api/practice-acoustic-model-identity.test.ts';
writeFileSync(testTo, readFileSync(testTo, 'utf8').replace('versioned Continuous asset', 'versioned Practice acoustic asset'));
console.log(JSON.stringify({ archived: manifest.length, removed: tree.length + 2 }));
