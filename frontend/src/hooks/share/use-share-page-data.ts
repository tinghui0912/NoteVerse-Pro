'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import { useShareAccess, useSharedXmlContent } from '@/hooks/queries/use-share-queries';
import { fetchSharedImage } from '@/lib/utils/image';
import { ApiError } from '@/lib/api-client';

export type ShareAccessErrorType = 'not_found' | 'revoked' | 'expired' | 'unknown';

export function useSharePageData(shareId: string) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const accessQuery = useShareAccess(shareId, { enabled: !authLoading });
  const shareData = accessQuery.data?.data ?? null;
  const xmlQuery = useSharedXmlContent(shareId, { enabled: Boolean(shareData) });
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const finalImages = useMemo(() => shareData?.task.files?.final_image ?? [], [shareData?.task.files?.final_image]);
  const imageSignature = useMemo(() => finalImages.map((image) => image.storage_key).join('|'), [finalImages]);

  useEffect(() => {
    const controller = new AbortController();
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    let loaded: string[] = [];
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setImagesLoading(finalImages.length > 0);
      setImageUrls([]);
      const urls = await Promise.all(
        finalImages.map((_, index) => fetchSharedImage(shareId, index + 1, 'final_image', controller.signal))
      );
      if (controller.signal.aborted) return;
      loaded = urls.filter((url): url is string => Boolean(url));
      loaded.forEach((url) => {
        if (url.startsWith('blob:')) ownedObjectUrls.add(url);
      });
      setImageUrls(loaded);
      setImagesLoading(false);
    });
    return () => {
      controller.abort();
      loaded.forEach((url) => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
          ownedObjectUrls.delete(url);
        }
      });
    };
  }, [finalImages, imageSignature, shareId]);

  useEffect(() => {
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    return () => {
      ownedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedObjectUrls.clear();
    };
  }, []);

  const error = useMemo(() => {
    const queryError = accessQuery.error;
    if (!queryError) return null;
    if (!(queryError instanceof ApiError)) return { type: 'unknown' as const, message: '' };
    const type: ShareAccessErrorType = queryError.code === 'share_not_found'
      ? 'not_found'
      : queryError.code === 'share_revoked'
        ? 'revoked'
        : queryError.code === 'share_expired'
          ? 'expired'
          : 'unknown';
    return {
      type,
      message: queryError.message,
      expiredAt: queryError.details?.expired_at as string | undefined,
    };
  }, [accessQuery.error]);

  return {
    authLoading,
    error,
    imageUrls,
    imagesLoading,
    isAuthenticated,
    loading: accessQuery.isLoading,
    rawXml: xmlQuery.data ?? null,
    shareData,
  };
}
