import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const sourceRoot = path.resolve('src');
const relative = (file: string) => path.relative(sourceRoot, file).replaceAll('\\', '/');
function files(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return files(file);
    return /\.tsx?$/.test(file) && !/\.test\./.test(file) ? [file] : [];
  });
}
const resourceReads: Record<string, string> = {
  'lib/practice/acoustic/source/browser-microphone-platform.ts': 'contract.coefficientUrl',
  'lib/practice/composite-video/download.ts': 'url',
};
const policyFiles = new Set([
  'lib/http/customer-browser-transport.ts',
  'lib/http/direct-object-upload.ts',
]);

it('routes programmatic Customer operations through generated SDK and explicit browser policies', () => {
  const violations: string[] = [];
  for (const file of files(sourceRoot)) {
    const name = relative(file);
    if (name.startsWith('generated/')) continue;
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node) {
      const fail = (reason: string) => violations.push(`${name}:${tree.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${reason}`);
      if ((ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
        ['ApiResponse', 'PaginatedResponse'].includes(node.name.text)) {
        fail('HTTP response shapes must come from generated schemas');
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.includes('generated/api/client') && !policyFiles.has(name) && !node.importClause?.isTypeOnly) {
        fail('Low-level generated client construction belongs to browser transport policy');
      }
      if (ts.isNewExpression(node) && node.expression.getText(tree) === 'Request' && !policyFiles.has(name)) {
        fail('Request construction belongs to the generated client or transport boundary');
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(tree);
        if (/^apiClient\.(get|post|put|patch|delete|upload|download|getRaw|postForm|postDownload)$/.test(callee) ||
          /\.client\.(get|post|put|patch|delete|request)$/.test(callee)) {
          fail('Feature operations must use the semantic generated SDK');
        }
        if (['fetch', 'globalThis.fetch', 'window.fetch'].includes(callee) && !policyFiles.has(name)) {
          if (resourceReads[name] !== node.arguments[0]?.getText(tree)) {
            fail('Fetch belongs to Customer policy, signed storage upload, or an identified non-API resource read');
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  expect(violations).toEqual([]);
});

it('generates a semantic SDK function for every Customer operation', () => {
  const spec = JSON.parse(fs.readFileSync('../../backend/docs/contracts/openapi/customer-api.json', 'utf8'));
  const ids = Object.values(spec.paths).flatMap(methods => Object.values(methods as Record<string, { operationId?: string }>).flatMap(op => op.operationId ? [op.operationId] : []));
  const sdk = fs.readFileSync('src/generated/api/sdk.gen.ts', 'utf8');
  const generated = [...sdk.matchAll(/export const ([A-Za-z0-9]+) =/g)].map(match => match[1]);
  expect(generated.sort()).toEqual(ids.sort());
});
