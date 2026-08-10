import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getScoreShareStatus, getShareExpirationDays } from '@/lib/score-detail/share';
import { parseScoreDetailSource } from '@/lib/score-detail/navigation';
import type { GrantRead } from '@/generated/api';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function share(overrides: Partial<GrantRead> = {}): GrantRead {
  return {
    grant_id: 'grant',
    token: 'grant',
    allow_download: true,
    allow_practice: true,
    created_at: '2026-01-01T00:00:00Z',
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
}

describe('score share helpers', () => {
  it('accepts only explicit library origins', () => {
    expect(parseScoreDetailSource('my-scores')).toBe('my-scores');
    expect(parseScoreDetailSource('shares')).toBe('shares');
    expect(parseScoreDetailSource(undefined)).toBeNull();
    expect(parseScoreDetailSource('invalid')).toBeNull();
  });

  it('prioritizes revoked status and detects expiration', () => {
    const now = new Date('2026-06-20T00:00:00Z');
    expect(getScoreShareStatus(share({ revoked_at: '2026-01-02T00:00:00Z' }), now)).toBe('revoked');
    expect(getScoreShareStatus(share({ expires_at: '2026-01-02T00:00:00Z' }), now)).toBe('expired');
    expect(getScoreShareStatus(share({ expires_at: '2027-01-02T00:00:00Z' }), now)).toBe('active');
  });

  it('maps fixed, permanent, and custom expiration options', () => {
    expect(getShareExpirationDays('7d')).toBe(7);
    expect(getShareExpirationDays('30d')).toBe(30);
    expect(getShareExpirationDays('permanent')).toBeNull();
    expect(getShareExpirationDays('custom', '2026-06-30', new Date('2026-06-21T00:00:00'))).toBe(10);
    expect(getShareExpirationDays('custom', '', new Date('2026-06-21T00:00:00'))).toBeUndefined();
    expect(getShareExpirationDays('invalid')).toBeUndefined();
  });

  it('keeps score share creation view-only', () => {
    const panel = readSource('src/components/score-detail/score-share-panel.tsx');
    const api = readSource('src/lib/api/score-sharing.ts');

    expect(panel).not.toContain('scope');
    expect(panel).not.toContain("permission === 'edit'");
    expect(panel).not.toContain('generateEditable');
    expect(api).not.toContain('scope:');
  });
});
