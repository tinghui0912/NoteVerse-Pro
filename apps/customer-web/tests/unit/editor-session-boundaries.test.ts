import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
const root = path.resolve(__dirname, '../../src');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(directory, entry.name))
      : /\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')
        ? [path.join(directory, entry.name)]
        : [],
  );
}
it('Editor features use the session and domain rather than XML music-editing APIs', () => {
  const violations: string[] = [];
  for (const file of [
    ...files(path.join(root, 'hooks/editor')),
    ...files(path.join(root, 'components/editor')),
  ]) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    source.forEachChild((node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (
          specifier.startsWith('@/lib/musicxml/') &&
          !['@/lib/musicxml/validator', '@/lib/musicxml/generic-render-ids'].includes(specifier)
        )
          violations.push(file + ': ' + specifier);
        if (specifier.startsWith('@/lib/editor-musicxml')) violations.push(file + ': ' + specifier);
      }
    });
  }
  expect(violations).toEqual([]);
});
it('MusicXML import belongs to explicit session load and external replacement boundaries', () => {
  const file = path.join(root, 'lib/editor/session.ts');
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const owners: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'importEditorMusicXml') {
      let parent: ts.Node | undefined = node.parent;
      while (parent && !ts.isPropertyDeclaration(parent)) parent = parent.parent;
      owners.push(
        parent && ts.isPropertyDeclaration(parent)
          ? parent.name.getText(source)
          : 'outside session operation',
      );
    }
    node.forEachChild(visit);
  }
  visit(source);
  expect(owners.sort()).toEqual(['loadMusicXml', 'replaceFromExternalMusicXml']);
});
