import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('owns authentication application entry points while routes only compose features', () => {
  const root = resolve(process.cwd(), 'src');
  for (const file of ['api.ts', 'return-url.ts', 'cache.ts', 'session/authentication-context.tsx']) expect(existsSync(resolve(root, 'features/authentication', file))).toBe(true);
  for (const old of ['contexts/auth-context.tsx', 'lib/api/auth.ts', 'lib/auth/return-url.ts']) expect(existsSync(resolve(root, old))).toBe(false);
  for (const route of ['login', 'register', 'verify-email', 'forgot-password', 'reset-password']) {
    const file = resolve(root, `app/[locale]/(auth)/auth/${route}/page.tsx`);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(source.statements.filter(ts.isImportDeclaration)).toHaveLength(1);
    const declaration = source.statements.find(ts.isImportDeclaration)!;
    expect((declaration.moduleSpecifier as ts.StringLiteral).text.startsWith('@/features/authentication/')).toBe(true);
    expect(source.statements.filter(ts.isFunctionDeclaration)).toHaveLength(1);
    expect(source.statements.find(ts.isFunctionDeclaration)?.body?.statements).toHaveLength(1);
  }
  expect(existsSync(resolve(root, 'components/auth/auth-card.tsx'))).toBe(true);
  expect(existsSync(resolve(root, 'features/account/security/confirm-email-change-page.tsx'))).toBe(true);
});
