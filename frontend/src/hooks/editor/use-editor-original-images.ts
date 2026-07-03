'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { importJobsApi } from '@/lib/api';

interface EditorOriginalImageArtifact {
  artifact_id: string;
  sha256?: string | null;
}

export function useEditorOriginalImages({
  jobId,
  artifacts,
  namespace = 'editor',
}: {
  jobId?: string | null;
  artifacts: EditorOriginalImageArtifact[];
  namespace?: 'editor' | 'review';
}) {
  const editorT = useTranslations('editor');
  const reviewT = useTranslations('review');
  const [originalImages, setOriginalImages] = useState<{ src: string; alt: string }[]>([]);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const signature = useMemo(
    () => artifacts.map((artifact) => `${artifact.artifact_id}:${artifact.sha256 ?? ''}`).join('|'),
    [artifacts]
  );

  useEffect(() => {
    const controller = new AbortController();
    const owned = ownedObjectUrlsRef.current;
    let loaded: string[] = [];
    if (!jobId || !artifacts.length) {
      return;
    }
    void Promise.all(
      artifacts.map((artifact) => importJobsApi.downloadImportJobArtifact(jobId, artifact.artifact_id))
    ).then((blobs) => {
      if (controller.signal.aborted) return;
      loaded = blobs.map(URL.createObjectURL);
      loaded.forEach((url) => owned.add(url));
      setOriginalImages(loaded.map((src, index) => ({
        src,
        alt: namespace === 'review'
          ? reviewT('originalScorePage', { page: index + 1 })
          : editorT('originalScorePage', { page: index + 1 }),
      })));
    });
    return () => {
      controller.abort();
      loaded.forEach((url) => {
        URL.revokeObjectURL(url);
        owned.delete(url);
      });
    };
  }, [artifacts, editorT, jobId, namespace, reviewT, signature]);

  useEffect(() => {
    const urls = ownedObjectUrlsRef.current;
    return () => {
      urls.forEach(URL.revokeObjectURL);
      urls.clear();
    };
  }, []);

  return jobId && artifacts.length ? originalImages : [];
}
