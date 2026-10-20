import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyRequiredPath, verifyRequiredPaths, validateRequiredRecords, summarizeInternalInventory, rejectDisplayedInventory } from './discovery.mjs';

const START = '1'.repeat(40), BLOB = '2'.repeat(40), FILE = 'src/exact.ts';
function fakeGit(entries = new Map([[FILE, { type: 'blob', sha: BLOB }]])) {
  return args => {
    if (args[0] === 'cat-file' && args[1] === '-t') {
      const found = [...entries.values()].find(e => e.sha === args[2]); if (!found) throw Error('MOCK_GIT_NONZERO');
      return Buffer.from(found.type + '\n');
    }
    const p = args[0] === 'ls-tree' ? args[4] : args.at(-1).slice(START.length + 1), found = entries.get(p);
    if (!found) throw Object.assign(Error('MOCK_GIT_NONZERO'), { status: 128 });
    if (args[0] === 'cat-file' && args[1] === '-e') return Buffer.alloc(0);
    if (args[0] === 'rev-parse') return Buffer.from(found.sha + '\n');
    if (args[0] === 'ls-tree') return Buffer.from((found.type === 'blob' ? '100644' : '040000') + ' ' + found.type + ' ' + found.sha + '\t' + p + '\0');
    throw Error('UNEXPECTED_SYNTHETIC_GIT_COMMAND');
  };
}
export function discoveryTests() {
  const results = [], test = (name, fn) => { fn(); results.push({ name, result: 'LOCAL_PASS_SYNTHETIC_ONLY' }); };
  test('A exact required blob path passes independent Git plumbing', () => {
    assert.deepEqual(verifyRequiredPath(fakeGit(), START, FILE), { path: FILE, exists: true, objectType: 'blob', blobSha: BLOB, startCommit: START });
  });
  test('B absent required path fails closed', () => assert.throws(() => verifyRequiredPath(fakeGit(), START, 'src/absent.ts'), /MOCK_GIT_NONZERO/));
  test('C long inventory with truncated display cannot affect exact path checks', () => {
    const full = [FILE, ...Array.from({ length: 12000 }, (_, i) => 'many/files/' + i + '.ts')].join('\0') + '\0';
    const displayed = 'Warning: truncated output\n' + full.slice(0, 40) + '... omitted middle ...';
    assert.equal(verifyRequiredPaths(fakeGit(), START, [FILE])[0].exists, true);
    assert.throws(() => rejectDisplayedInventory(displayed), /NEVER_MEMBERSHIP_AUTHORITY/);
    assert.equal(summarizeInternalInventory(Buffer.from(full), START, [FILE]).entryCount, 12001);
  });
  test('D Warning truncated output is rejected as authority', () => assert.throws(() => rejectDisplayedInventory('Warning: truncated output'), /NEVER_MEMBERSHIP_AUTHORITY/));
  test('E omitted-middle display marker is rejected as authority', () => assert.throws(() => rejectDisplayedInventory('begin ...34240 tokens omitted... end'), /NEVER_MEMBERSHIP_AUTHORITY/));
  test('F internal binary count and SHA256 are deterministic', () => {
    const raw = Buffer.from(FILE + '\0src/other.ts\0'), first = summarizeInternalInventory(raw, START, [FILE]);
    assert.deepEqual(first, summarizeInternalInventory(Buffer.from(raw), START, [FILE]));
    assert.equal(first.entryCount, 2); assert.equal(first.rawInventoryByteCount, raw.length);
    assert.equal(first.rawInventorySha256, createHash('sha256').update(raw).digest('hex')); assert.equal(first.allRequiredPathsPresent, true);
    assert.throws(() => summarizeInternalInventory(raw.toString(), START, [FILE]), /INTERNAL_BINARY_INVENTORY/);
  });
  test('G duplicate required-path record fails', () => {
    const r = verifyRequiredPath(fakeGit(), START, FILE); assert.throws(() => validateRequiredRecords([r, r], [FILE, 'src/other.ts']), /DUPLICATE_REQUIRED_PATH_RECORD/);
    assert.throws(() => verifyRequiredPaths(fakeGit(), START, [FILE, FILE]), /DUPLICATE_REQUIRED_PATH/);
  });
  test('H unexpected blob identity change fails', () => assert.throws(() => verifyRequiredPath(fakeGit(), START, FILE, '3'.repeat(40)), /UNEXPECTED_BLOB_IDENTITY/));
  test('I nonzero Git command exit fails', () => assert.throws(() => verifyRequiredPath(() => { throw Object.assign(Error('NONZERO_EXIT'), { status: 1 }); }, START, FILE), /NONZERO_EXIT/));
  test('J directory existence cannot substitute for a required file blob', () => {
    const git = fakeGit(new Map([['src', { type: 'tree', sha: '4'.repeat(40) }]]));
    assert.throws(() => verifyRequiredPath(git, START, 'src/exact.ts'), /MOCK_GIT_NONZERO/);
    assert.throws(() => verifyRequiredPath(git, START, 'src'), /REQUIRED_FILE_IS_NOT_BLOB/);
  });
  return results;
}
