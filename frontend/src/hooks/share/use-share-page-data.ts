'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useGrantAccess, useGrantContent } from '@/hooks/queries/use-score-queries';
import { scoreSharingApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';

export type ShareAccessErrorType = 'not_found' | 'revoked' | 'expired' | 'unknown';

export function useSharePageData(shareId: string) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const accessQuery = useGrantAccess(shareId);
  const shareData = accessQuery.data?.data ?? null;
  const contentQuery = useGrantContent(shareId);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const images = useMemo(
    () => shareData?.artifacts.filter((artifact) => artifact.kind === 'RENDERED_PAGE') ?? [],
    [shareData?.artifacts]
  );
  const signature = images.map((image) => `${image.artifact_id}:${image.sha256}`).join('|');

  useEffect(() => {
    const controller = new AbortController();
    const owned = ownedObjectUrlsRef.current;
    let loaded: string[] = [];
    if (!images.length) return;
    void Promise.resolve().then(async () => {
      setImagesLoading(true);
      return Promise.all(
        images.map((image) => scoreSharingApi.viewArtifact(shareId, image.artifact_id))
      );
    }).then((blobs) => {
      if (controller.signal.aborted) return;
      loaded = blobs.map(URL.createObjectURL);
      loaded.forEach((url) => owned.add(url));
      setImageUrls(loaded);
    }).finally(() => {
      if (!controller.signal.aborted) setImagesLoading(false);
    });
    return () => {
      controller.abort();
      loaded.forEach((url) => {
        URL.revokeObjectURL(url);
        owned.delete(url);
      });
    };
  }, [images, shareId, signature]);

  useEffect(() => {
    const owned = ownedObjectUrlsRef.current;
    return () => {
      owned.forEach(URL.revokeObjectURL);
      owned.clear();
    };
  }, []);

  const error = useMemo(() => {
    const queryError = accessQuery.error ?? contentQuery.error;
    if (!queryError) return null;
    if (!(queryError instanceof ApiError)) return { type: 'unknown' as const, message: '' };
    const type: ShareAccessErrorType = queryError.code === 'share_not_found'
      ? 'not_found'
      : queryError.code === 'share_revoked'
        ? 'revoked'
        : queryError.code === 'share_expired'
          ? 'expired'
          : 'unknown';
    return { type, message: queryError.message };
  }, [accessQuery.error, contentQuery.error]);

  return {
    authLoading,
    error,
    imageUrls: images.length ? imageUrls : [],
    imagesLoading,
    isAuthenticated,
    loading: accessQuery.isLoading || contentQuery.isLoading,
    rawXml: contentQuery.data?.data?.content ?? null,
    shareData,
  };
}
