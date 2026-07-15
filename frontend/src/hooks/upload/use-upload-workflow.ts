'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useImportJobDetail, useSubmitImportJob } from '@/hooks/queries/use-import-job-queries';
import { useToast } from '@/hooks/use-toast';
import { filesApi, importJobsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import type { ScoreTaxonomyTagValue } from '@/lib/score/taxonomy';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { getCompletedJobRoute, type UploadableFile } from '@/lib/upload/upload-workflow';

const TASK_POLL_INTERVAL_MS = 2_000;
const TASK_WAIT_TIMEOUT_MS = 18 * 60 * 1_000;

function createSubmissionIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revokePreview(preview: string) {
  if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
}

class UserFacingUploadError extends Error {}

export function useUploadWorkflow() {
  const t = useTranslations('upload');
  const tCommon = useTranslations('common');
  const errors = useTranslations('errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const submitJobMutation = useSubmitImportJob();
  const [files, setFiles] = useState<UploadableFile[]>([]);
  const filesRef = useRef<UploadableFile[]>([]);
  const submissionKeyRef = useRef<string | null>(null);
  const [scoreName, setScoreName] = useState('');
  const [taxonomyTags, setTaxonomyTags] = useState<ScoreTaxonomyTagValue[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number | false>(false);
  const [pollStartTime, setPollStartTime] = useState(0);
  const urlJobId = searchParams.get('job_id');
  const translateTaskError = useCallback((codeOrMessage: string | null | undefined, fallback: string) => {
    if (!codeOrMessage) return fallback;
    if (errors.has(codeOrMessage as never)) return errors(codeOrMessage as never);
    if (t.has(codeOrMessage as never)) return t(codeOrMessage as never);
    return fallback;
  }, [errors, t]);

  const setTrackedFiles = useCallback((next: UploadableFile[] | ((current: UploadableFile[]) => UploadableFile[])) => {
    setFiles((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      filesRef.current = value;
      return value;
    });
  }, []);

  const clearFiles = useCallback(() => {
    filesRef.current.forEach(({ preview }) => revokePreview(preview));
    setTrackedFiles([]);
    submissionKeyRef.current = null;
  }, [setTrackedFiles]);

  const appendFiles = useCallback((acceptedFiles: File[]) => {
    submissionKeyRef.current = null;
    const additions = acceptedFiles.map<UploadableFile>((file) => ({
      file,
      preview: URL.createObjectURL(file),
      status: 'pending',
    }));
    setTrackedFiles((current) => [...current, ...additions]);
  }, [setTrackedFiles]);

  const removeFile = useCallback((index: number) => {
    submissionKeyRef.current = null;
    setTrackedFiles((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed) revokePreview(removed.preview);
      return next;
    });
  }, [setTrackedFiles]);

  const { data: statusResponse } = useImportJobDetail(currentJobId ?? '', {
    enabled: Boolean(currentJobId) && pollInterval !== false,
    refetchInterval: pollInterval,
  });

  useEffect(() => {
    const job = statusResponse?.data;
    if (!job || !currentJobId) return;

    if (Date.now() - pollStartTime > TASK_WAIT_TIMEOUT_MS) {
      const description = t('processingTimeoutDesc');
      toast({ title: t('processingTimeout'), description, variant: 'destructive' });
      setTaskError(description);
      setIsSubmitting(false);
      setCurrentJobId(null);
      setPollInterval(false);
      return;
    }

    setTaskProgress(job.progress || 0);
    const state = String(job.state).toUpperCase();
    if (state === 'PENDING_REVIEW' || state === 'CONFIRMED') {
      const completedScoreId = job.score_id;
      if (state === 'CONFIRMED' && !completedScoreId) {
        setTaskError(t('taskProcessingFailed'));
        setIsSubmitting(false);
        setCurrentJobId(null);
        setPollInterval(false);
        return;
      }
      setIsSubmitting(false);
      setCurrentJobId(null);
      setPollInterval(false);
      setTaskProgress(0);
      clearFiles();
      router.push(getCompletedJobRoute(job.job_id, completedScoreId, state));
    } else if (state === 'FAILURE') {
      setTaskError(translateTaskError(job.public_code, t('taskProcessingFailed')));
      setIsSubmitting(false);
      setCurrentJobId(null);
      setPollInterval(false);
    }
  }, [clearFiles, currentJobId, pollStartTime, router, statusResponse?.data, t, toast, translateTaskError]);

  useEffect(() => {
    if (!urlJobId) return;
    const controller = new AbortController();
    const restoredBlobUrls: string[] = [];

    void Promise.resolve().then(async () => {
      try {
        const response = await importJobsApi.getImportJob(urlJobId, controller.signal);
        const data = response.data;
        if (!data || controller.signal.aborted) return;

        if (data.title) setScoreName(data.title);
        if (data.taxonomy_tags) {
          setTaxonomyTags(data.taxonomy_tags as ScoreTaxonomyTagValue[]);
        }

        const originalImages = data.original_images ?? [];
        const restoredFiles: UploadableFile[] = [];
        for (let index = 0; index < originalImages.length; index += 1) {
          const blob = await importJobsApi.downloadImportJobArtifact(
            urlJobId,
            originalImages[index].artifact_id
          );
          const preview = URL.createObjectURL(blob);
          if (!preview || controller.signal.aborted) continue;
          if (preview.startsWith('blob:')) restoredBlobUrls.push(preview);
          const originalImage = originalImages[index];
          const fallbackName = originalImage.filename;
          restoredFiles.push({
            file: new File([], originalImage.original_filename || fallbackName || `image_${index + 1}.png`, {
              type: 'image/png',
            }),
            preview,
            status: 'uploaded',
            fileId: originalImage.upload_id,
          });
        }
        if (controller.signal.aborted) return;
        if (restoredFiles.length > 0) setTrackedFiles(restoredFiles);

        const state = String(data.state).toUpperCase();
        if (state === 'PENDING' || state === 'RUNNING') {
          setCurrentJobId(urlJobId);
          setIsSubmitting(true);
          setTaskProgress(data.progress || 0);
          setPollStartTime(Date.now());
          setPollInterval(TASK_POLL_INTERVAL_MS);
        } else if (state === 'FAILURE') {
          setTaskError(translateTaskError(data.public_code, t('processingFailed')));
          setTaskProgress(0);
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error('Failed to restore upload task:', error);
      }
    });

    return () => {
      controller.abort();
      restoredBlobUrls.forEach(revokePreview);
    };
  }, [setTrackedFiles, t, translateTaskError, urlJobId]);

  useEffect(() => () => {
    filesRef.current.forEach(({ preview }) => revokePreview(preview));
  }, []);

  const startRecognition = useCallback(async () => {
    if (filesRef.current.length === 0) return;
    setCurrentJobId(null);
    setTaskProgress(0);
    setTaskError(null);
    setIsUploading(true);

    try {
      const uploadedFileIds: string[] = [];
      for (let index = 0; index < filesRef.current.length; index += 1) {
        const currentFile = filesRef.current[index];
        if (currentFile.status === 'uploaded' && currentFile.fileId) {
          uploadedFileIds.push(currentFile.fileId);
          continue;
        }
        if (currentFile.file.size === 0) {
          const message = t('restoredFileUnavailable', { name: currentFile.file.name });
          setTrackedFiles((current) => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'error', error: message } : item
          ));
          throw new UserFacingUploadError(message);
        }

        setTrackedFiles((current) => current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, status: 'uploading' } : item
        ));
        try {
          const response = await filesApi.uploadFile(currentFile.file);
          const fileId = response.data?.file_id;
          if (!fileId) throw new Error(tCommon('operationFailed'));
          uploadedFileIds.push(fileId);
          void queryClient.invalidateQueries({ queryKey: queryKeys.storageUsage.current() });
          setTrackedFiles((current) => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'uploaded', fileId } : item
          ));
        } catch (error) {
          const message = userFacingErrorMessage(errors, error, tCommon('operationFailed'));
          setTrackedFiles((current) => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'error', error: message } : item
          ));
          throw new UserFacingUploadError(message);
        }
      }

      setIsUploading(false);
      setIsSubmitting(true);
      submissionKeyRef.current ??= createSubmissionIdempotencyKey();
      const response = await submitJobMutation.mutateAsync({
        fileIds: uploadedFileIds,
        idempotencyKey: submissionKeyRef.current,
        options: { title: scoreName || undefined, taxonomy_tags: taxonomyTags },
      });
      const jobId = response.data?.job_id;
      if (!jobId) throw new UserFacingUploadError(tCommon('operationFailed'));
      submissionKeyRef.current = null;
      setCurrentJobId(jobId);
      setTaskProgress(0);
      setPollStartTime(Date.now());
      setPollInterval(TASK_POLL_INTERVAL_MS);
      toast({ title: t('taskStarted'), description: t('taskStartedDesc') });
    } catch (error) {
      const message = error instanceof UserFacingUploadError && error.message
          ? error.message
          : userFacingErrorMessage(errors, error, t('processingFailed'));
      toast({ title: t('submitFailed'), description: message, variant: 'destructive' });
      setIsUploading(false);
      setIsSubmitting(false);
    }
  }, [errors, queryClient, scoreName, setTrackedFiles, submitJobMutation, t, taxonomyTags, tCommon, toast]);

  return {
    appendFiles,
    clearFiles,
    files,
    isProcessing: isUploading || isSubmitting,
    isSubmitting,
    isUploading,
    removeFile,
    scoreName,
    setScoreName,
    setTaxonomyTags,
    startRecognition,
    taskError,
    taskErrorMessage: taskError ?? '',
    taskProgress,
    taxonomyTags,
  };
}
