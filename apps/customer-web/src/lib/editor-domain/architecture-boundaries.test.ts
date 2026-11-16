import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = path.resolve(__dirname);
function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(path.join(directory, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')
        ? [path.join(directory, entry.name)]
        : [],
  );
}
it('editor domain depends only on domain-local modules', () => {
  const violations: string[] = [];
  for (const file of sources(root)) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function check(specifier: string) {
      const target = specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier)
        : specifier.startsWith('@/lib/editor-domain/')
          ? path.resolve(root, specifier.slice('@/lib/editor-domain/'.length))
          : null;
      if (!target || (target !== root && !target.startsWith(root + path.sep)))
        violations.push(`${file}: ${specifier}`);
    }
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteral(node.argument.literal)
      )
        check(node.argument.literal.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      )
        check(node.arguments[0].text);
      node.forEachChild(visit);
    }
    visit(source);
  }
  expect(violations).toEqual([]);
});
