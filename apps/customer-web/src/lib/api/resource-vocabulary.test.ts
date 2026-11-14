import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { expect, it } from 'vitest';
const root = resolve(process.cwd(), 'src');
function productionFiles(directory: string): string[] {
  return readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? productionFiles(path) : /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}
it('uses canonical Upload and PerformanceTake resource identifiers', () => {
  expect(existsSync(resolve(root, 'lib/api/uploads.ts'))).toBe(true);
  expect(existsSync(resolve(root, 'lib/api/files.ts'))).toBe(false);
  expect(existsSync(resolve(root, 'lib/practice/performance-take/admission.ts'))).toBe(true);
  expect(existsSync(resolve(root, 'lib/practice/saved-take'))).toBe(false);
  const forbidden = /\b(?:filesApi|fileId|fileIds|uploadedFileIds|SavedTake\w*|savedTake\w*|useSavedTakeExportBundle)\b/;
  for (const path of productionFiles(root)) expect(readFileSync(path, 'utf8'), path).not.toMatch(forbidden);
  const api = readFileSync(resolve(root, 'lib/api/uploads.ts'), 'utf8');
  expect(api).toContain('createUpload(file: File)');
  expect(api).toContain('createUploads(');
  expect(api).toContain('deleteUpload(uploadId: string)');
  const workflow = readFileSync(resolve(root, 'lib/upload/upload-workflow.ts'), 'utf8');
  expect(workflow).toContain('uploadId?: string');
  const keys = readFileSync(resolve(root, 'lib/query-client.ts'), 'utf8');
  expect(keys).toContain('performanceTakeExport:');
  expect(keys).toContain('performance-take-export-bundle');
});
