import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const sourceRoot = path.resolve('src');
const performanceRoot = path.join(sourceRoot, 'lib/score/performance');
const transportRoot = path.join(sourceRoot, 'generated/api');
const realizationLibraries = new Set(['@tonejs/midi', 'midi-file']);
const inside = (file: string, owner: string) =>
  file === owner || file.startsWith(owner + path.sep);

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? productionFiles(file)
      : /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file)
        ? [file]
        : [];
  });
}

it('keeps the performance package within exact projection, generated transport and written realization dependencies', () => {
  const violations: string[] = [];
  for (const file of productionFiles(performanceRoot)) {
    const tree = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const check = (specifier: string) => {
      const target = specifier.startsWith('@/')
        ? path.join(sourceRoot, specifier.slice(2))
        : specifier.startsWith('.')
          ? path.resolve(path.dirname(file), specifier)
          : null;
      if (
        target
          ? !inside(target, performanceRoot) && !inside(target, transportRoot)
          : !realizationLibraries.has(specifier)
      )
        violations.push(`${path.relative(sourceRoot, file)} -> ${specifier}`);
    };
    const visit = (node: ts.Node) => {
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
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteral(argument))
          violations.push(`${file}: unresolvable dependency`);
        else check(argument.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  expect(violations).toEqual([]);
});
