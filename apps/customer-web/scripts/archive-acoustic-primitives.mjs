import { readFile, writeFile, mkdir, copyFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const revision = 'ae0408df03dfd19447b6191fbee7688cd0fd4edf';
const destination = 'backend/research/history/continuous-acoustic-before-promotion';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', revision, 'apps/customer-web'], { cwd: root, encoding: 'utf8' })
  .trim().split('\n').filter(p => /\/acoustic-inference\/xc[467][^/]*$|\/scripts\/xc[567][^/]*$|\/public\/engineering\/xc[46]\//.test(p));
const rows = [];
for (const originalPath of paths) {
  const file = path.join(root, originalPath), bytes = await readFile(file);
  const archivePath = `${destination}/${originalPath}`;
  const archive = path.join(root, archivePath);
  await mkdir(path.dirname(archive), { recursive: true });
  await copyFile(file, archive);
  if (hash(await readFile(archive)) !== hash(bytes)) throw new Error('ARCHIVE_BYTE_MISMATCH');
  rows.push({ originalPath, originalRevision: revision,
    originalGitBlob: execFileSync('git', ['rev-parse', `${revision}:${originalPath}`], { cwd: root, encoding: 'utf8' }).trim(),
    archivePath, bytes: bytes.length, sha256: hash(bytes), storage: 'exact working-file bytes; archive -text prevents EOL conversion' });
}
for (const [oldPath, newPath] of [
  ['public/engineering/xc4/fir-160-441.f32', 'public/model-assets/continuous/fir-160-441.f32'],
  ['public/engineering/xc6/fir-1-3.f32', 'public/model-assets/continuous/fir-1-3.f32'],
]) {
  const target = path.join(root, 'apps/customer-web', newPath);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(root, 'apps/customer-web', oldPath), target);
}
await writeFile(path.join(root, destination, 'manifest.json'), JSON.stringify({ originalRevision: revision, entries: rows }, null, 2) + '\n', { flag: 'wx' });
// Delete only the individually verified superseded files, never a computed recursive directory.
for (const row of rows) await unlink(path.join(root, row.originalPath));
console.log(JSON.stringify({ archivedFiles: rows.length, manifest: `${destination}/manifest.json` }));
