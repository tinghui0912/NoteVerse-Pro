import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = path.resolve(__dirname);
it('editor domain is independent from UI and serialization adapters', () => {
  const violations: string[] = [];
  for (const file of readdirSync(root).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  )) {
    const source = ts.createSourceFile(
      file,
      readFileSync(path.join(root, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    function check(specifier: string) {
      const target = specifier.startsWith('.')
        ? path.resolve(root, specifier)
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
