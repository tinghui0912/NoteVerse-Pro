import { describe, expect, it } from 'vitest';
import { getResultsShareStatus, getShareExpirationDays } from '@/lib/results/share';
import { parseResultsHistorySource } from '@/lib/results/navigation';
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
  it('accepts only explicit history origins', () => {
    expect(parseResultsHistorySource('uploads')).toBe('uploads');
    expect(parseResultsHistorySource('shares')).toBe('shares');
    expect(parseResultsHistorySource(undefined)).toBeNull();
    expect(parseResultsHistorySource('invalid')).toBeNull();
  });

  it('prioritizes revoked status and detects expiration', () => {
    const now = new Date('2026-06-20T00:00:00Z');
    expect(getResultsShareStatus(share({ revoked_at: '2026-01-02T00:00:00Z' }), now)).toBe('revoked');
    expect(getResultsShareStatus(share({ expires_at: '2026-01-02T00:00:00Z' }), now)).toBe('expired');
    expect(getResultsShareStatus(share({ expires_at: '2027-01-02T00:00:00Z' }), now)).toBe('active');
  });

  it('maps fixed, permanent, and custom expiration options', () => {
    expect(getShareExpirationDays('7d')).toBe(7);
    expect(getShareExpirationDays('30d')).toBe(30);
    expect(getShareExpirationDays('permanent')).toBeNull();
    expect(getShareExpirationDays('custom', '2026-06-30', new Date('2026-06-21T00:00:00'))).toBe(10);
    expect(getShareExpirationDays('custom', '', new Date('2026-06-21T00:00:00'))).toBeUndefined();
    expect(getShareExpirationDays('invalid')).toBeUndefined();
  });
});
