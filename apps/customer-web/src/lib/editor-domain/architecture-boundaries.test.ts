import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const editorDomainRoot = path.resolve(__dirname);

const forbiddenImports = [
  '@/types/score-types',
  '@/lib/editor/',
  '@/lib/musicxml/',
  '@/components/editor/',
  '../editor/',
  '../musicxml/',
];

describe('editor-domain architecture boundary', () => {
  it('does not depend on legacy score editor models or UI adapters', () => {
    const violations = collectSourceFiles(editorDomainRoot)
      .flatMap((file) => {
        const content = readFileSync(file, 'utf8');
        const importPaths = Array.from(content.matchAll(/import\s+(?:type\s+)?[\s\S]*?\s+from\s+['"]([^'"]+)['"]/g))
          .map((match) => match[1] ?? '');
        return forbiddenImports
          .filter((importPath) => importPaths.some((actualImportPath) => actualImportPath.includes(importPath)))
          .map((importPath) => `${path.relative(editorDomainRoot, file)} imports ${importPath}`);
      });

    expect(violations).toEqual([]);
  });
});

function collectSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(absolute));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(absolute);
    }
  }
  return files;
}
