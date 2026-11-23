import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const root = resolve(process.cwd(), 'src');
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
const parse = (file: string) => ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
function nodes(source: ts.Node): ts.Node[] {
  const result = [source]; source.forEachChild((node) => { result.push(...nodes(node)); }); return result;
}

function isCacheOwner(file: string) {
  const path = relative(root, file).replaceAll('\\', '/');
  return path.startsWith('lib/cache-effects/') || /^features\/(?:[^/]+\/)+cache\.ts$/.test(path);
}

it('keeps server-state cache mutation and cache inspection inside semantic effects', () => {
  const primitives = new Set(['invalidateQueries', 'setQueryData', 'setQueriesData', 'removeQueries', 'cancelQueries', 'getQueriesData', 'getQueryData', 'resetQueries']);
  const violations = files(root).filter((file) => !isCacheOwner(file)).flatMap((file) =>
    nodes(parse(file)).filter(ts.isCallExpression).filter((call) => {
      const expression = call.expression;
      const name = ts.isPropertyAccessExpression(expression) ? expression.name.text
        : ts.isElementAccessExpression(expression) && expression.argumentExpression && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : '';
      return primitives.has(name);
    }).map(() => relative(root, file)),
  );
  expect(violations).toEqual([]);
});

it('limits semantic effects to cache mechanics, query identities and generated representations', () => {
  for (const file of files(root).filter(isCacheOwner)) {
    const source = parse(file);
    for (const statement of source.statements.filter(ts.isImportDeclaration)) {
      const modulePath = (statement.moduleSpecifier as ts.StringLiteral).text;
      expect(modulePath === '@tanstack/react-query' || modulePath === '@/lib/query-client' || modulePath === '@/lib/query-auth-scope' || modulePath === '@/generated/api' || modulePath === '@/lib/realtime/generated/events' || modulePath.startsWith('./') || modulePath.startsWith('@/lib/cache-effects/') || /^@\/features\/(?:[^/]+\/)+(?:cache|query-keys)$/.test(modulePath)).toBe(true);
      if (modulePath === '@/generated/api' || modulePath === '@/lib/realtime/generated/events') expect(statement.importClause?.isTypeOnly).toBe(true);
    }
    const calls = nodes(source).filter(ts.isCallExpression);
    expect(calls.filter((call) => ts.isIdentifier(call.expression) && /^(fetch|use[A-Z])/.test(call.expression.text))).toEqual([]);
  }
});

it('keeps provider transport free of query identities and maps changes with an exhaustive switch', () => {
  const provider = parse(resolve(root, 'components/providers/realtime-provider.tsx'));
  expect(provider.statements.filter(ts.isImportDeclaration).map((node) => (node.moduleSpecifier as ts.StringLiteral).text)).not.toContain('@/lib/query-client');
  const mapper = nodes(parse(resolve(root, 'lib/cache-effects/realtime.ts')));
  expect(mapper.filter(ts.isSwitchStatement)).toHaveLength(1);
  expect(mapper.filter(ts.isVariableDeclaration).some((node) => node.type?.kind === ts.SyntaxKind.NeverKeyword)).toBe(true);
});
