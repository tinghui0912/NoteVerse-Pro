import { vi } from 'vitest';
import { CSRF_COOKIE_NAME } from '@/lib/app-protocol';

export function customerFetch(data: unknown = {}) {
  if (typeof document === 'undefined') vi.stubGlobal('document', { cookie: `${CSRF_COOKIE_NAME}=test-csrf` });
  else document.cookie = `${CSRF_COOKIE_NAME}=test-csrf; path=/`;
  const send = vi.fn<typeof fetch>(async () => Response.json({ success: true, data }));
  vi.stubGlobal('fetch', send);
  return send;
}
