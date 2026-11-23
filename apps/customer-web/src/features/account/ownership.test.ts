import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { queryKeys } from '@/lib/query-client';
import { accountQueryKeys } from './query-keys';
import { authenticationApi } from '@/features/authentication/api';

it('owns Security and Sessions identities while Authentication holds the current principal', () => {
  expect(accountQueryKeys).toEqual({all: ['account'], security: expect.any(Function), sessions: expect.any(Function)});
  expect(accountQueryKeys.security()).toEqual(['account', 'security']);
  expect(accountQueryKeys.sessions()).toEqual(['account', 'sessions']);
  expect(queryKeys).not.toHaveProperty('account');
  expect(authenticationApi).not.toHaveProperty('confirmEmailChange');
});

it('has explicit Profile, Security and Sessions owners and shared Settings composition', () => {
  const root = resolve(process.cwd(), 'src');
  for (const lifecycle of ['profile', 'security', 'sessions']) {
    for (const file of ['api.ts', 'queries.ts', `${lifecycle}-settings-${lifecycle === 'profile' ? 'form' : 'panel'}.tsx`]) {
      expect(existsSync(resolve(root, 'features/account', lifecycle, file))).toBe(true);
    }
  }
  for (const path of ['features/account/query-keys.ts', 'features/account/cache.ts', 'features/account/security/confirm-email-change-page.tsx', 'components/settings/settings-shell.tsx', 'app/[locale]/(auth)/auth/confirm-email-change/page.tsx']) expect(existsSync(resolve(root, path))).toBe(true);
  for (const path of ['hooks/queries/use-profile-mutations.ts', 'lib/api/profile.ts', 'lib/cache-effects/account.ts', ...['profile-settings-form', 'security-settings-panel', 'password-settings-form', 'sessions-settings-panel', 'avatar-cropper-modal', 'crop-image'].map(name => `components/settings/${name}.${name === 'crop-image' ? 'ts' : 'tsx'}`)]) expect(existsSync(resolve(root, path))).toBe(false);
});
