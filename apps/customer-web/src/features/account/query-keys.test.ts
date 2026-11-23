import { expect, it } from 'vitest';
import { accountQueryKeys } from './query-keys';
it('identifies Account security and sessions independently', () => {
  expect(accountQueryKeys.all).toEqual(['account']);
  expect(accountQueryKeys.security()).toEqual(['account', 'security']);
  expect(accountQueryKeys.sessions()).toEqual(['account', 'sessions']);
});
