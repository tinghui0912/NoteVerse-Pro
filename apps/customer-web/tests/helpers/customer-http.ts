import { vi } from 'vitest';

export function customerFetch(data: unknown = {}) {
  const send = vi.fn<typeof fetch>(async () => Response.json(data));
  vi.stubGlobal('fetch', send);
  return send;
}
