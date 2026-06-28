'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useJobDetail } from '@/hooks/queries/use-job-queries';
import { useApproveScore, useRevisionContent, useScoreDetail } from '@/hooks/queries/use-score-queries';
import { jobsApi } from '@/lib/api';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import { validateDataIntegrity } from '@/lib/musicxml/validator';
import type { ProcessingArtifact } from '@/types/api';

function useReviewArtifacts(jobId: string | null, artifacts: ProcessingArtifact[]) {
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

export function useReviewPageData(scoreId: string) {
  const t = useTranslations('review');
  const editor = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const router = useRouter();
  const scoreQuery = useScoreDetail(scoreId);
  const score = scoreQuery.data?.data;
  const revisionId = score?.head_revision_id ?? '';
  const revisionQuery = useRevisionContent(scoreId, revisionId);
  const xmlContent = revisionQuery.data?.data?.content ?? null;
  const jobId = score?.originating_job_id ?? null;
  const jobQuery = useJobDetail(jobId ?? '', { enabled: Boolean(jobId) });
  const job = jobQuery.data?.data;
  const originalFiles = useMemo(() => job?.artifacts?.original_image ?? [], [job?.artifacts?.original_image]);
  const previewFiles = useMemo(() => job?.artifacts?.preview_image ?? [], [job?.artifacts?.preview_image]);
  const original = useReviewArtifacts(jobId, originalFiles);
  const preview = useReviewArtifacts(jobId, previewFiles);
  const approve = useApproveScore();

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
    const queryError = scoreQuery.error ?? jobQuery.error ?? revisionQuery.error;
    if (queryError) return queryError instanceof Error ? queryError.message : t('loadFailed');
    if (score && score.state !== 'ACTIVE' && score.state !== 'IN_REVIEW') {
      return t('invalidTaskState', { state: score.state });
    }
    if (score && !jobId) return t('loadFailed');
    return null;
  }, [jobId, jobQuery.error, revisionQuery.error, score, scoreQuery.error, t]);

  const confirmRecognition = () => approve.mutate(scoreId, {
    onSuccess: (response) => {
      if (response.success) router.push(`/results/${scoreId}`);
    },
  });

  return {
    confirmRecognition,
    confirming: approve.isPending,
    error,
    loading: scoreQuery.isLoading || revisionQuery.isLoading || (Boolean(jobId) && jobQuery.isLoading),
    original,
    preview,
    validationWarnings,
  };
}
