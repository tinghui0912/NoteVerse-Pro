'use client';

import { useMemo } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useGrantAccess } from '@/hooks/queries/use-score-queries';
import { ApiError } from '@/lib/api-client';

export type ShareAccessErrorType = 'not_found' | 'revoked' | 'expired' | 'unknown';

export function useSharePageData(shareId: string) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const accessQuery = useGrantAccess(shareId);
  const shareData = accessQuery.data?.data ?? null;

  const error = useMemo(() => {
    const queryError = accessQuery.error;
    if (!queryError) return null;
    if (!(queryError instanceof ApiError)) return { type: 'unknown' as const };
    const type: ShareAccessErrorType = queryError.code === 'share_not_found'
      ? 'not_found'
      : queryError.code === 'share_revoked'
        ? 'revoked'
        : queryError.code === 'share_expired'
          ? 'expired'
          : 'unknown';
    return { type };
  }, [accessQuery.error]);

  return {
    authLoading,
    error,
    isAuthenticated,
    loading: accessQuery.isLoading,
    shareData,
  };
}
