'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useConfirmImportJobReview, useImportJobReview } from '@/features/imports/queries';
import { importJobsApi } from '@/features/imports/api/jobs';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import {importEditorMusicXml} from '@/lib/editor-musicxml';
import { validateDataIntegrity } from '@/lib/musicxml/validator';
import { scoreLocation } from '@/features/scores/routes';
import type { ReviewArtifactRead } from '@/generated/api';

function useReviewArtifacts(jobId: string | null, artifacts: ReviewArtifactRead[]) {
  const [urls, setUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const ownedUrls = useRef(new Set<string>());
  const signature = artifacts
    .map((item) => `${item.artifact_id}:${item.filename}:${item.size ?? ''}`)
    .join('|');

  useEffect(() => {
    const controller = new AbortController();
    const owned = ownedUrls.current;
    let created: string[] = [];
    if (!jobId || artifacts.length === 0) return;
    void Promise.resolve().then(async () => {
      setLoading(true);
      return Promise.all(
        artifacts.map((artifact) => importJobsApi.downloadImportJobArtifact(jobId, artifact.artifact_id))
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
  const editor = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const errors = useTranslations('errors');
  const router = useRouter();
  const reviewQuery = useImportJobReview(jobId);
  const review = reviewQuery.data;
  const xmlContent = review?.musicxml?.content ?? null;
  const originalFiles = useMemo(() => review?.original_images ?? [], [review?.original_images]);
  const original = useReviewArtifacts(jobId, originalFiles);
  const confirm = useConfirmImportJobReview();

  useEffect(() => {
    if (review?.state === 'CONFIRMED' && review.score_id) {
      router.replace(scoreLocation(review.score_id));
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
      const {document} = importEditorMusicXml(xmlContent);
      return validateDataIntegrity(document, xmlContent, translateValidationKey).warnings;
    } catch {
      return [];
    }
  }, [translateValidationKey, xmlContent]);

  const error = useMemo(() => {
    const queryError = reviewQuery.error;
    if (queryError) {
      return userFacingErrorMessage(errors, queryError, common('loadFailedDescription'));
    }
    return null;
  }, [common, errors, reviewQuery.error]);

  const confirmRecognition = () => {
    if (!xmlContent) return;
    confirm.mutate({
      jobId,
      content: xmlContent,
      displayTitle: review?.display_title ?? undefined,
    }, {
    onSuccess: (response) => {
      if (response.score_id) {
        router.push(scoreLocation(response.score_id));
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
    recognizedXml: xmlContent,
    validationWarnings,
  };
}
