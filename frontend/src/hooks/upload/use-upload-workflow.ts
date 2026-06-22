'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { UploadableFile } from '@/components/upload/upload-types';
import { getCompletedScoreRoute } from '@/components/upload/upload-types';
import { useJobDetail, useSubmitJob } from '@/hooks/queries/use-job-queries';
import { useToast } from '@/hooks/use-toast';
import { filesApi, jobsApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';

const TASK_POLL_INTERVAL_MS = 2_000;
const TASK_WAIT_TIMEOUT_MS = 18 * 60 * 1_000;

function createSubmissionIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revokePreview(preview: string) {
  if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
}

export function useUploadWorkflow() {
  const t = useTranslations('upload');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const submitJobMutation = useSubmitJob();
  const [files, setFiles] = useState<UploadableFile[]>([]);
  const filesRef = useRef<UploadableFile[]>([]);
  const submissionKeyRef = useRef<string | null>(null);
  const [scoreName, setScoreName] = useState('');
  const [difficulty, setDifficulty] = useState('difficultyIntermediate');
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<number | false>(false);
  const [pollStartTime, setPollStartTime] = useState(0);
  const urlJobId = searchParams.get('job_id');

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

  const { data: statusResponse } = useJobDetail(currentJobId ?? '', {
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
    if (state === 'PENDING_REVIEW' || state === 'SUCCESS') {
      const completedScoreId = job.score_id;
      if (!completedScoreId) {
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
      router.push(getCompletedScoreRoute(completedScoreId, state));
    } else if (state === 'FAILURE') {
      setTaskError(job.error || t('taskProcessingFailed'));
      setIsSubmitting(false);
      setCurrentJobId(null);
      setPollInterval(false);
    }
  }, [clearFiles, currentJobId, pollStartTime, router, statusResponse?.data, t, toast]);

  useEffect(() => {
    if (!urlJobId) return;
    const controller = new AbortController();
    const restoredBlobUrls: string[] = [];

    void Promise.resolve().then(async () => {
      try {
        const response = await jobsApi.getJob(urlJobId, controller.signal);
        const data = response.data;
        if (!data || controller.signal.aborted) return;

        if (data.title) setScoreName(data.title);
        if (data.difficulty) setDifficulty(data.difficulty);

        const originalImages = data.artifacts?.original_image ?? [];
        const uploadIds = data.upload_ids ?? [];
        const restoredFiles: UploadableFile[] = [];
        for (let index = 0; index < originalImages.length; index += 1) {
          const blob = await jobsApi.downloadJobArtifact(
            urlJobId,
            originalImages[index].artifact_id
          );
          const preview = URL.createObjectURL(blob);
          if (!preview || controller.signal.aborted) continue;
          if (preview.startsWith('blob:')) restoredBlobUrls.push(preview);
          const uploadInfo = uploadIds[index];
          const originalImage = originalImages[index];
          const fallbackName = originalImage.filename || originalImage.storage_key?.split('/').pop();
          restoredFiles.push({
            file: new File([], uploadInfo?.original_filename || fallbackName || `image_${index + 1}.png`, {
              type: 'image/png',
            }),
            preview,
            status: 'uploaded',
            sha256: uploadInfo?.sha256,
          });
        }
        if (controller.signal.aborted) return;
        if (restoredFiles.length > 0) setTrackedFiles(restoredFiles);

        const state = String(data.state).toUpperCase();
        if (state === 'PENDING' || state === 'PROGRESS') {
          setCurrentJobId(urlJobId);
          setIsSubmitting(true);
          setTaskProgress(data.progress || 0);
          setPollStartTime(Date.now());
          setPollInterval(TASK_POLL_INTERVAL_MS);
        } else if (state === 'FAILURE') {
          setTaskError(data.error || t('processingFailed'));
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
  }, [setTrackedFiles, t, urlJobId]);

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
        if (currentFile.sha256) {
          uploadedFileIds.push(currentFile.sha256);
          continue;
        }
        if (currentFile.status === 'uploaded' && currentFile.fileId) {
          uploadedFileIds.push(currentFile.fileId);
          continue;
        }
        if (currentFile.file.size === 0) {
          const message = t('restoredFileUnavailable', { name: currentFile.file.name });
          setTrackedFiles((current) => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'error', error: message } : item
          ));
          throw new Error(message);
        }

        setTrackedFiles((current) => current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, status: 'uploading' } : item
        ));
        try {
          const response = await filesApi.uploadFile(currentFile.file);
          const fileId = response.data?.file_id;
          if (!fileId) throw new Error(tCommon('operationFailed'));
          uploadedFileIds.push(fileId);
          setTrackedFiles((current) => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'uploaded', fileId } : item
          ));
        } catch (error) {
          const message = error instanceof ApiError ? error.message : tCommon('operationFailed');
          setTrackedFiles((current) => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'error', error: message } : item
          ));
          throw new Error(t('uploadFailedFile', { name: currentFile.file.name }));
        }
      }

      setIsUploading(false);
      setIsSubmitting(true);
      submissionKeyRef.current ??= createSubmissionIdempotencyKey();
      const response = await submitJobMutation.mutateAsync({
        fileIds: uploadedFileIds,
        idempotencyKey: submissionKeyRef.current,
        options: { title: scoreName || undefined, difficulty },
      });
      const jobId = response.data?.job_id;
      if (!jobId) throw new Error(tCommon('operationFailed'));
      submissionKeyRef.current = null;
      setCurrentJobId(jobId);
      setTaskProgress(5);
      setPollStartTime(Date.now());
      setPollInterval(TASK_POLL_INTERVAL_MS);
      toast({ title: t('taskStarted'), description: t('taskStartedDesc') });
    } catch (error) {
      const message = error instanceof ApiError
        ? error.message
        : error instanceof Error && error.message
          ? error.message
          : t('processingFailed');
      toast({ title: t('submitFailed'), description: message, variant: 'destructive' });
      setIsUploading(false);
      setIsSubmitting(false);
    }
  }, [difficulty, scoreName, setTrackedFiles, submitJobMutation, t, tCommon, toast]);

  return {
    appendFiles,
    clearFiles,
    difficulty,
    files,
    isProcessing: isUploading || isSubmitting,
    isSubmitting,
    isUploading,
    removeFile,
    scoreName,
    setDifficulty,
    setScoreName,
    startRecognition,
    taskError,
    taskErrorMessage: taskError && t.has(taskError as never) ? t(taskError as never) : taskError ?? '',
    taskProgress,
  };
}
