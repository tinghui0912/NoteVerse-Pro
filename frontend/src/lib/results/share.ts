import type { Share } from '@/types/api';

export type ResultsShareStatus = 'active' | 'revoked' | 'expired';

export function getResultsShareStatus(share: Share, now = new Date()): ResultsShareStatus {
  if (share.revoked_at) return 'revoked';
  if (share.expires_at && new Date(share.expires_at) < now) return 'expired';
  return 'active';
}

export function getShareExpirationDays(expiration: string) {
  return { '1d': 1, '7d': 7, '30d': 30, '365d': 365, perm: 999 }[expiration] ?? 7;
}
