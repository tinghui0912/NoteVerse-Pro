import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const START = '65b122d9f3b1185a9bf33e4b787a7595e4fccdd2';
const ts = createRequire(import.meta.url)(path.join(ROOT, 'apps/customer-web/node_modules/typescript'));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const prefix = 'apps/customer-web/src/lib/practice/acoustic-inference/';
const remove = ['bytedance-worker-client.ts', 'bytedance-worker-factory.ts', 'bytedance-worker-protocol.ts', 'bytedance-worker.entry.ts', 'bytedance-capture.worklet.js'].map(p => prefix + p)
  .concat(['apps/customer-web/scripts/bytedance-model-opfs-smoke.mjs', 'apps/customer-web/scripts/bytedance-worker-webgpu-smoke.mjs']);
const copies = [prefix + 'bytedance-inference.test.ts', prefix + 'README.md'];
const all = git('ls-tree', '-r', '--name-only', START, 'apps/customer-web/src', 'apps/customer-web/scripts').split('\n').filter(p => /\.(ts|tsx|js|mjs)$/.test(p));
const edges = [];
for (const file of all) {
  const bytes = execFileSync('git', ['show', `${START}:${file}`], { cwd: ROOT });
  const tree = ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, true);
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const spec = node.moduleSpecifier.text;
      const base = spec.startsWith('@/') ? `apps/customer-web/src/${spec.slice(2)}` : spec.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)) : null;
      const to = base ? [base, base + '.ts', base + '.tsx', base + '.js', base + '/index.ts'].find(p => all.includes(p)) : null;
      edges.push({ from: file, specifier: spec, to: to ?? null });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
}
const archive = path.join(ROOT, 'backend/research/history/continuous-controller-alternate-executables');
await mkdir(archive, { recursive: true });
const manifest = [];
for (const original of [...remove, ...copies]) {
  const working = await readFile(path.join(ROOT, original));
  const bytes = execFileSync('git', ['show', `${START}:${original}`], { cwd: ROOT });
  if (working.toString('utf8').replaceAll('\r\n', '\n') !== bytes.toString('utf8').replaceAll('\r\n', '\n')) throw new Error('ARCHIVE_CONTENT_NOT_BASELINE:' + original);
  const destination = path.join(archive, path.basename(original));
  try { await writeFile(destination, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || !(await readFile(destination)).equals(bytes)) throw error; }
  manifest.push({ original, originalRevision: START, gitBlobSha: git('rev-parse', `${START}:${original}`),
    bytes: bytes.length, sha256: hash(bytes), archived: path.relative(ROOT, destination).replaceAll('\\', '/'),
    archiveByteIdentity: 'EXACT_GIT_BLOB_BYTES', workingBytes: working.length, workingSha256: hash(working),
    workingDifference: working.equals(bytes) ? 'NONE' : 'GIT_WORKTREE_LINE_ENDINGS_ONLY',
    action: remove.includes(original) ? 'ARCHIVE_AND_REMOVE_UNUSED_ALTERNATE_EXECUTABLE' : 'ARCHIVE_BEFORE_NARROW_ACTIVE_TEST_OR_DOC_MIGRATION',
    incomingAtBaseline: edges.filter(e => e.to === original) });
}
await writeFile(path.join(archive, '.gitattributes'), '* -text\n', { flag: 'wx' });
await writeFile(path.join(archive, 'manifest.json'), JSON.stringify({ startingHead: START,
  rationale: 'Alternate worker/capture executables have only barrel, their own smoke and historical protocol-test consumers. Those obsolete exports/tests are removed; shared decoder, raw output contracts, preprocessing and provider primitives remain unchanged.',
  previousInventory: 'backend/research/reports/continuous_application_import_inventory_2026-10-17.json',
  currentInventoryRevision: START, parser: `typescript ${ts.version}`, edges, files: manifest }, null, 2) + '\n', { flag: 'wx' });
for (const original of remove) await unlink(path.join(ROOT, original));

// Mechanical AST deletion of tests/helpers that exercised only the retired worker.
const testFile = prefix + 'bytedance-inference.test.ts';
let source = (await readFile(path.join(ROOT, testFile))).toString('utf8');
const tree = ts.createSourceFile(testFile, source, ts.ScriptTarget.Latest, true);
const edits = [];
for (const node of tree.statements) {
  const name = ts.isFunctionDeclaration(node) ? node.name?.text : ts.isVariableStatement(node) ? node.declarationList.declarations[0]?.name.getText(tree) : null;
  const isWorkerTests = ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(tree) === 'describe' && node.expression.arguments[0]?.text === 'ByteDance worker protocol';
  if (isWorkerTests || ['mockRuntime', 'verifiedManifest', 'verifiedModelBytes', 'passThroughModelLoader'].includes(name)) edits.push({ start: node.getFullStart(), end: node.end, text: '' });
  if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === './index') {
    const retained = node.importClause.namedBindings.elements.filter(e => !['BYTEDANCE_OUTPUT_DESCRIPTORS', 'ByteDanceWorkerHost', 'ByteDanceWorkerProtocolRuntime',
      'createByteDanceBrowserWorkerClient', 'loadOnnxRuntimeWeb', 'ByteDanceModelLoader', 'ByteDanceOnnxRuntime'].includes(e.name.text));
    edits.push({ start: node.getStart(tree), end: node.end, text: `import {\n${retained.map(e => '  ' + e.getText(tree)).join(',\n')},\n} from './index';` });
  }
}
for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
await writeFile(path.join(ROOT, testFile), source);
const index = path.join(ROOT, prefix, 'index.ts');
await writeFile(index, (await readFile(index, 'utf8')).split(/\r?\n/).filter(l => !/bytedance-worker-(factory|protocol)/.test(l)).join('\n'));
console.log(JSON.stringify({ archived: manifest.length, removed: remove.length, mechanicalTestEdits: edits.length }));
