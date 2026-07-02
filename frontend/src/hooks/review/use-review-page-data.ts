'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirmJobReview, useJobReview } from '@/hooks/queries/use-review-queries';
import { jobsApi } from '@/lib/api';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import { validateDataIntegrity } from '@/lib/musicxml/validator';
import type { ReviewArtifact } from '@/types/api';

function useReviewArtifacts(jobId: string | null, artifacts: ReviewArtifact[]) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const ownedUrls = useRef(new Set<string>());
  const signature = artifacts.map((item) => `${item.artifact_id}:${item.sha256 ?? ''}`).join('|');

  useEffect(() => {
    const controller = new AbortController();
    const owned = ownedUrls.current;
    let created: string[] = [];
    if (!jobId || artifacts.length === 0) return;
    void Promise.resolve().then(async () => {
      setLoading(true);
      return Promise.all(
        artifacts.map((artifact) => jobsApi.downloadJobArtifact(jobId, artifact.artifact_id))
      );
    }).then((blobs) => {
      if (controller.signal.aborted) return;
      created = blobs.map(URL.createObjectURL);
      created.forEach((url) => owned.add(url));
      setUrls(created);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => {
      controller.abort();
      created.forEach((url) => {
        URL.revokeObjectURL(url);
        owned.delete(url);
      });
    };
  }, [artifacts, jobId, signature]);

  useEffect(() => {
    const urls = ownedUrls.current;
    return () => {
      urls.forEach(URL.revokeObjectURL);
      urls.clear();
    };
  }, []);

  return { loading, urls: jobId && artifacts.length ? urls : [] };
}

export function useReviewPageData(jobId: string) {
  const t = useTranslations('review');
  const editor = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const router = useRouter();
  const reviewQuery = useJobReview(jobId);
  const review = reviewQuery.data?.data;
  const xmlContent = review?.musicxml?.content ?? null;
  const originalFiles = useMemo(() => review?.original_images ?? [], [review?.original_images]);
  const previewFiles = useMemo(() => review?.preview_images ?? [], [review?.preview_images]);
  const original = useReviewArtifacts(jobId, originalFiles);
  const preview = useReviewArtifacts(jobId, previewFiles);
  const confirm = useConfirmJobReview();

  useEffect(() => {
    if (review?.state === 'SUCCESS' && review.score_id) {
      router.replace(`/score/${review.score_id}`);
    }
  }, [review?.score_id, review?.state, router]);

  const translateValidationKey = useCallback((key: string) => {
    if (!key.includes('.')) return editor(key as never);
    const [namespace, ...rest] = key.split('.');
    const nestedKey = rest.join('.');
    if (namespace === 'editor') return editor(nestedKey as never);
    if (namespace === 'common') return common(nestedKey as never);
    if (namespace === 'validation' || namespace === 'auth') return auth(`validation.${nestedKey}` as never);
    return key;
  }, [auth, common, editor]);

  const validationWarnings = useMemo(() => {
    if (!xmlContent) return [];
    try {
      const scoreData = new MusicXMLParser(xmlContent).parse();
      return validateDataIntegrity(scoreData, xmlContent, translateValidationKey).warnings;
    } catch (error) {
      console.error('[Review] Failed to validate recognition result:', error);
      return [];
    }
  }, [translateValidationKey, xmlContent]);

  const error = useMemo(() => {
    const queryError = reviewQuery.error;
    if (queryError) return queryError instanceof Error ? queryError.message : t('loadFailed');
    return null;
  }, [reviewQuery.error, t]);

  const confirmRecognition = () => {
    if (!xmlContent) return;
    confirm.mutate({
      jobId,
      content: xmlContent,
      title: review?.title ?? undefined,
    }, {
    onSuccess: (response) => {
      if (response.success && response.data?.score_id) {
        router.push(`/score/${response.data.score_id}`);
      }
    },
    });
  };

  return {
    confirmRecognition,
    confirming: confirm.isPending,
    error,
    loading: reviewQuery.isLoading,
    original,
    preview,
    validationWarnings,
  };
}
