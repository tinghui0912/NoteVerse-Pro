import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('Continuous model construction has no historical manifest/provider/loader dependency', () => {
  const source = readFileSync('src/lib/practice/acoustic/model/model-inference.ts', 'utf8');
  const ast = ts.createSourceFile('model-inference.ts', source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [], calls: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  expect(imports).toContain('../../../model-assets/verified-model-asset-loader');
  expect(imports).toContain('./acoustic-model-manifest');
  expect(imports).not.toContain('../../../model-assets/bytedance-model-loader');
  expect(imports).not.toContain('../bytedance-onnx-provider');
  expect(calls).not.toContain('defaultByteDanceModelManifest');
  expect(calls).not.toContain('createOpfsByteDanceModelLoader');
});
