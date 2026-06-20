'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchAuthenticatedImage } from '@/lib/utils/image';

interface ThumbnailRequest {
  key: string;
  taskId?: string;
  thumbnailType?: string;
}

interface ThumbnailResult {
  url: string;
  error: boolean;
}

export function useHistoryThumbnails(requests: ThumbnailRequest[]) {
  const [results, setResults] = useState<Record<string, ThumbnailResult>>({});
  const loadedRef = useRef(new Set<string>());
  const objectUrlsRef = useRef(new Set<string>());
  const requestKey = useMemo(
    () => requests.map(({ key, taskId, thumbnailType }) => `${key}:${taskId ?? ''}:${thumbnailType ?? ''}`).join('|'),
    [requests]
  );

  useEffect(() => {
    const controller = new AbortController();
    let settled = false;
    const loadedKeys = loadedRef.current;
    const pending = requests.filter(
      ({ key, taskId, thumbnailType }) => taskId && thumbnailType && !loadedKeys.has(key)
    );
    pending.forEach(({ key }) => loadedKeys.add(key));

    void Promise.all(
      pending.map(async ({ key, taskId, thumbnailType }) => {
        const url = await fetchAuthenticatedImage(
          taskId as string,
          thumbnailType as string,
          1,
          undefined,
          undefined,
          controller.signal
        );
        return { key, url };
      })
    ).then((loaded) => {
      settled = true;
      if (controller.signal.aborted) return;
      setResults((current) => {
        const next = { ...current };
        loaded.forEach(({ key, url }) => {
          if (url?.startsWith('blob:')) objectUrlsRef.current.add(url);
          next[key] = { url: url ?? '', error: !url };
        });
        return next;
      });
    });

    return () => {
      controller.abort();
      if (!settled) pending.forEach(({ key }) => loadedKeys.delete(key));
    };
  }, [requestKey, requests]);

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrlsRef.current.clear();
    },
    []
  );

  return results;
}
