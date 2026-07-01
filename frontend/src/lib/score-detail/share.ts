import type { ScoreGrant } from '@/types/api';

export type ScoreShareStatus = 'active' | 'revoked' | 'expired';

export function getScoreShareStatus(share: ScoreGrant, now = new Date()): ScoreShareStatus {
  if (share.revoked_at) return 'revoked';
  if (share.expires_at && new Date(share.expires_at) < now) return 'expired';
  return 'active';
}

export function getShareExpirationDays(expiration: string, customDate?: string, now = new Date()) {
  if (expiration === 'permanent') return null;
  if (expiration === 'custom') {
    if (!customDate) return undefined;
    const expiresAt = new Date(`${customDate}T23:59:59`);
    const days = Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
    return Number.isFinite(days) && days > 0 ? days : undefined;
  }
  return { '7d': 7, '30d': 30 }[expiration];
}
