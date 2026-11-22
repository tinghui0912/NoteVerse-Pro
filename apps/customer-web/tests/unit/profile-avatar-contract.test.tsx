// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AccountAvatarUploadResponse, AccountProfileGetResponse } from '@/generated/api';
import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { profileApi } from '@/features/account/profile/api';

const filename = `1_${'a'.repeat(64)}_${'b'.repeat(32)}.jpg`;
const avatarUrl = `/api/v1/me/avatars/${filename}`;
afterEach(() => vi.unstubAllGlobals());

it('keeps the server-provided browser resource URL in the authenticated user', async () => {
  const payload = { user: { id: 1, email: 'user@example.test', display_name: 'User', is_active: true, avatar_url: avatarUrl, created_at: '2026-11-13T00:00:00Z' } } satisfies AccountProfileGetResponse;
  const send = vi.fn<typeof fetch>(async () => Response.json(payload));
  vi.stubGlobal('fetch', send);
  const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
  await waitFor(() => expect(result.current.user?.avatar).toBe(avatarUrl));
  expect(result.current.isAuthenticated).toBe(true);
});

it('returns the uploaded avatar resource URL unchanged from the generated operation', async () => {
  const payload = { filename, avatar_url: avatarUrl } satisfies AccountAvatarUploadResponse;
  const send = vi.fn<typeof fetch>(async () => Response.json(payload));
  vi.stubGlobal('fetch', send);
  const result = await profileApi.uploadAvatar(new File(['avatar'], 'avatar.png', { type: 'image/png' }));
  expect(result.avatar_url).toBe(avatarUrl);
});

it('acknowledges a profile update with no response representation', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', send);
  await expect(profileApi.updateProfile({ display_name: 'Updated' })).resolves.toBeUndefined();
});
