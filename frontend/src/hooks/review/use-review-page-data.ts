'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTaskDetail } from '@/hooks/queries/use-task-queries';
import { useConfirmRecognition } from '@/hooks/queries/use-xml-queries';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import type { TaskFile } from '@/types/api';

const getImageVersion = (image: TaskFile | undefined) =>
  [image?.storage_key, image?.size, image?.created_at].filter(Boolean).join(':');

function useReviewImages(taskId: string, fileType: 'original_image' | 'preview_image', files: TaskFile[]) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const signature = useMemo(() => files.map(getImageVersion).join('|'), [files]);

  useEffect(() => {
    const controller = new AbortController();
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    let loaded: string[] = [];
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setLoading(files.length > 0);
      setUrls([]);
      const results = await Promise.all(files.map((file, index) =>
        fetchAuthenticatedImage(taskId, fileType, index + 1, undefined, getImageVersion(file), controller.signal)
      ));
      if (controller.signal.aborted) return;
      loaded = results.filter((url): url is string => Boolean(url));
      loaded.forEach((url) => {
        if (url.startsWith('blob:')) ownedObjectUrls.add(url);
      });
      setUrls(loaded);
      setLoading(false);
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
  }, [files, fileType, signature, taskId]);

  useEffect(() => {
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    return () => {
      ownedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
      ownedObjectUrls.clear();
    };
  }, []);

  return { loading, urls };
}

export function useReviewPageData(taskId: string) {
  const t = useTranslations('review');
  const router = useRouter();
  const taskQuery = useTaskDetail(taskId);
  const task = taskQuery.data?.data ?? null;
  const originalFiles = useMemo(() => task?.files?.original_image ?? [], [task?.files?.original_image]);
  const previewFiles = useMemo(() => task?.files?.preview_image ?? [], [task?.files?.preview_image]);
  const original = useReviewImages(taskId, 'original_image', originalFiles);
  const preview = useReviewImages(taskId, 'preview_image', previewFiles);
  const confirm = useConfirmRecognition();
  const error = useMemo(() => {
    if (taskQuery.error) return taskQuery.error instanceof Error ? taskQuery.error.message : t('loadFailed');
    if (task && task.state !== 'SUCCESS' && task.state !== 'PENDING_REVIEW') return t('invalidTaskState', { state: task.state });
    return null;
  }, [t, task, taskQuery.error]);

  const confirmRecognition = () => confirm.mutate({ taskId }, {
    onSuccess: (response) => {
      if (response.success) router.push(`/results/${taskId}`);
    },
  });

  return { confirmRecognition, confirming: confirm.isPending, error, loading: taskQuery.isLoading, original, preview };
}
