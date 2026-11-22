import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { queryKeys } from '@/lib/query-client';
import { scoreQueryKeys } from './core/query-keys';
import { collaborationQueryKeys } from './collaboration/query-keys';
import { guestPreviewQueryKeys } from './guest-preview/query-keys';
import { scoreLocation, scoreEditLocation } from './routes';

it('owns three independent Score product query namespaces', () => {
  expect([scoreQueryKeys.all, collaborationQueryKeys.all, guestPreviewQueryKeys.all]).toEqual([['scores'], ['score-collaboration'], ['guest-preview']]);
  expect(queryKeys).not.toHaveProperty('scores');
  expect(collaborationQueryKeys.myInvites()).toEqual(['score-collaboration', 'pending']);
  expect(guestPreviewQueryKeys.settings('score')[1]).toBe('settings');
  expect(guestPreviewQueryKeys.public('token')[1]).toBe('public');
});

it('keeps local cache modules independent of the other Score lifecycles', () => {
  for (const owner of ['core', 'collaboration', 'guest-preview']) {
    const file = resolve(process.cwd(), `src/features/scores/${owner}/cache.ts`);
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const dependencies = source.statements.filter(ts.isImportDeclaration).map((n) => (n.moduleSpecifier as ts.StringLiteral).text);
    expect(dependencies.filter((dependency) => dependency.startsWith('@/features/scores/') && !dependency.startsWith(`@/features/scores/${owner}/`))).toEqual([]);
  }
});

it('uses final lifecycle entry points without parallel API/query owners', () => {
  const root = resolve(process.cwd(), 'src');
  for (const owner of ['core', 'collaboration', 'guest-preview']) {
    for (const file of ['api', 'queries', 'query-keys', 'cache']) expect(existsSync(resolve(root, `features/scores/${owner}/${file}.ts`))).toBe(true);
  }
  for (const path of ['hooks/queries/use-score-queries.ts', 'hooks/guest-preview/use-guest-preview.ts', 'lib/api/scores.ts', 'lib/api/score-invites.ts', 'lib/api/guest-previews.ts']) expect(existsSync(resolve(root, path))).toBe(false);
});

it('builds Score detail and edit locations without owning Practice navigation', () => {
  expect(scoreLocation('score/id')).toBe('/score/score%2Fid');
  expect(scoreEditLocation('score/id')).toBe('/score/score%2Fid/edit');
});
