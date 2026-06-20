import { describe, expect, it } from 'vitest';
import { getResultsShareStatus, getShareExpirationDays } from '@/lib/results/share';
import type { Share } from '@/types/api';

function share(overrides: Partial<Share> = {}): Share {
  return {
    id: 1,
    share_token: 'token',
    task_id: 'task',
    created_at: '2026-01-01T00:00:00Z',
    expires_at: null,
    revoked_at: null,
    ...overrides,
  } as Share;
}

describe('results share helpers', () => {
  it('prioritizes revoked status and detects expiration', () => {
    const now = new Date('2026-06-20T00:00:00Z');
    expect(getResultsShareStatus(share({ revoked_at: '2026-01-02T00:00:00Z' }), now)).toBe('revoked');
    expect(getResultsShareStatus(share({ expires_at: '2026-01-02T00:00:00Z' }), now)).toBe('expired');
    expect(getResultsShareStatus(share({ expires_at: '2027-01-02T00:00:00Z' }), now)).toBe('active');
  });

  it('maps supported expiration options with a conservative default', () => {
    expect(getShareExpirationDays('1d')).toBe(1);
    expect(getShareExpirationDays('perm')).toBe(999);
    expect(getShareExpirationDays('invalid')).toBe(7);
  });
});
