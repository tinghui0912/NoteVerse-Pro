import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { queryKeys } from '@/lib/query-client';
import { storageUsageQueryKeys } from './query-keys';

it('owns one stable Storage Usage query identity', () => {
  expect(storageUsageQueryKeys.all).toEqual(['storage-usage']);
  expect(storageUsageQueryKeys.current()).toEqual(['storage-usage', 'current']);
  expect(queryKeys).not.toHaveProperty('storageUsage');
});
it('has final feature owners and canonical routes without parallel owners', () => {
  const root = resolve(process.cwd(), 'src');
  for (const path of ['features/storage-usage/api.ts', 'features/storage-usage/query-keys.ts', 'features/storage-usage/queries.ts', 'features/storage-usage/cache.ts', 'features/storage-usage/storage-settings-panel.tsx', 'app/[locale]/(app)/settings/storage/page.tsx']) expect(existsSync(resolve(root, path))).toBe(true);
  for (const path of ['lib/api/storage-usage.ts', 'hooks/queries/use-storage-usage-query.ts', 'lib/cache-effects/storage.ts', 'components/settings/billing-settings-panel.tsx', 'app/[locale]/(app)/settings/billing']) expect(existsSync(resolve(root, path))).toBe(false);
  const file = resolve(root, 'app/[locale]/(app)/settings/storage/page.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  expect(source.statements.filter(ts.isImportDeclaration)).toHaveLength(1);
  expect(source.statements.find(ts.isFunctionDeclaration)?.body?.statements).toHaveLength(1);
});
