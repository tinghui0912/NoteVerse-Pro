import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getResultsShareStatus, getShareExpirationDays } from '@/lib/results/share';
import { parseResultsHistorySource } from '@/lib/results/navigation';
import type { ScoreGrant } from '@/types/api';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function share(overrides: Partial<ScoreGrant> = {}): ScoreGrant {
  return {
    grant_id: 'grant',
    token: 'grant',
    target_mode: 'LATEST',
    target_revision_id: null,
    allow_download: true,
    allow_practice: true,
    created_at: '2026-01-01T00:00:00Z',
    expires_at: null,
    revoked_at: null,
    ...overrides,
  };
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

  it('keeps results share creation view-only', () => {
    const dialog = readSource('src/components/results/results-share-dialog.tsx');
    const api = readSource('src/lib/api/score-sharing.ts');

    expect(dialog).not.toContain('scope');
    expect(dialog).not.toContain("permission === 'edit'");
    expect(dialog).not.toContain('generateEditable');
    expect(api).not.toContain('scope:');
  });
});
