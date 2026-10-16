import {execFileSync} from 'node:child_process';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Mechanical, byte-preserving archival of code bound to the retired product contract.
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
const revision = '705da526368320469e3090523f14f75fd3f3f8a5';
const prefix = 'apps/customer-web/src/lib/practice/';
const historical = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, `${prefix}research`], {encoding: 'utf8'}).trim().split('\n').filter(Boolean);
const dependencies = ['local-core/continuous-finalization-ledger.ts', 'local-core/continuous-evaluation-session.ts',
  'audio-analysis/continuous/performance-reconciler.ts', 'completed-performance.ts'];
const files = [...historical, ...dependencies.map(file => prefix + file)];
const destination = 'backend/research/history/continuous-product-core-before-promotion';
const manifest = [];
for (const file of files) {
  const bytes = execFileSync('git', ['show', `${revision}:${file}`], {maxBuffer: 20 * 1024 * 1024});
  const target = path.join(root, destination, file.slice(prefix.length));
  await mkdir(path.dirname(target), {recursive: true});
  await writeFile(target, bytes);
  manifest.push({path: file, sha256: createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(path.join(root, destination, 'manifest.json'), JSON.stringify({revision,
  purpose: 'Immutable provenance, not executable product dependencies. Reproduce historical runs from the recorded Git revision.', files: manifest}, null, 2) + '\n');
await rm(path.join(root, prefix, 'research'), {recursive: true});
await rm(path.join(root, prefix, 'local-core/continuous-finalization-ledger.ts'));
await rm(path.join(root, prefix, 'audio-analysis/continuous/performance-reconciler.ts'));
