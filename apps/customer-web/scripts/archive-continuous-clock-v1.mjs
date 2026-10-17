import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const revision = '556689315368f876e5655afa755ad262ff803d40';
const archive = 'backend/research/history/continuous-clock-contract-v1-output-timestamp';
const originals = [
  'apps/customer-web/src/lib/practice/continuous/continuous-capture-clock-synchronizer.ts',
  'apps/customer-web/src/lib/practice/continuous/continuous-capture-clock-synchronizer.test.ts',
  'apps/customer-web/scripts/continuous-clock-contract-entry.ts',
];
const rows = [];
for (const original of originals) {
  const bytes = await readFile(path.join(root, original));
  const committed = execFileSync('git', ['show', `${revision}:${original}`], { cwd: root });
  if (!bytes.equals(committed)) throw new Error('ARCHIVE_SOURCE_NOT_EXACT_COMMITTED_BYTES:' + original);
  const destination = `${archive}/${path.basename(original)}`;
  await mkdir(path.dirname(path.join(root, destination)), { recursive: true });
  await writeFile(path.join(root, destination), bytes, { flag: 'wx' });
  if (!bytes.equals(await readFile(path.join(root, destination)))) throw new Error('ARCHIVE_COPY_CHANGED');
  rows.push({ original, archived: destination, originalRevision: revision,
    gitBlobSha: execFileSync('git', ['rev-parse', `${revision}:${original}`], { cwd: root, encoding: 'utf8' }).trim(),
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(path.join(root, archive, '.gitattributes'), '* -text\n', { flag: 'wx' });
await writeFile(path.join(root, archive, 'manifest.json'), JSON.stringify({
  historicalProtocol: 'SINGLE_FIXED_AFFINE_GET_OUTPUT_TIMESTAMP_ANCHOR_UNIT_SLOPE',
  status: 'FAILED_HISTORICAL_ONLY_NEVER_PRODUCT_FALLBACK', files: rows,
  entryNote: 'Failed qualification entry archived outside product compilation because it imports the removed synchronizer. Historical reports and other failed protocol tooling remain unchanged.',
}, null, 2) + '\n', { flag: 'wx' });
for (const original of originals) await unlink(path.join(root, original));
console.log(JSON.stringify(rows));
