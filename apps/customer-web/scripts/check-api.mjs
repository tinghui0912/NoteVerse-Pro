import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function snapshot(directory) {
  const files = {};
  function visit(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) visit(file);
      else files[path.relative(directory, file).replaceAll('\\', '/')] = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
    }
  }
  visit(directory);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

const directory = mkdtempSync(path.join(tmpdir(), 'noteverse-api-'));
try {
  const output = path.join(directory, 'api');
  execFileSync(process.execPath, ['node_modules/@hey-api/openapi-ts/bin/run.js', '--output', output], {encoding: 'utf8'});
  if (JSON.stringify(snapshot('src/generated/api')) !== JSON.stringify(snapshot(output))) {
    throw new Error('Generated Customer API artifacts are stale. Run npm run generate:api.');
  }
  console.log('Generated Customer API artifacts are current.');
} finally {
  rmSync(directory, {recursive: true, force: true});
}
