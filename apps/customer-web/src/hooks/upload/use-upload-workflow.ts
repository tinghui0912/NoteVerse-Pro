'use client';

import type { ScoreGenre } from '@/generated/api';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import {
  useImportJobDetail,
  useSubmitImportJob,
} from '@/hooks/queries/use-import-job-queries';
import { useToast } from '@/hooks/use-toast';
import { uploadsApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { knownGenres } from '@/lib/score/genres';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';
import {
  getCompletedJobRoute,
  type UploadableFile,
} from '@/lib/upload/upload-workflow';

const TASK_POLL_INTERVAL_MS = 2_000;
const TASK_WAIT_TIMEOUT_MS = 18 * 60 * 1_000;

type UploadTaskState = {
  currentJobId: string | null;
  isSubmitting: boolean;
  pollInterval: number | false;
  pollStartTime: number;
  taskError: string | null;
  taskProgress: number;
};

type UploadTaskAction =
  | { type: 'reset' }
  | { type: 'submit_started' }
  | {
      type: 'track_job';
      jobId: string;
      progress?: number;
      pollStartTime: number;
    }
  | { type: 'progress'; progress: number }
  | { type: 'completed' }
  | { type: 'failed'; message: string }
  | { type: 'submit_failed' }
  | { type: 'timeout'; message: string };

const initialTaskState: UploadTaskState = {
  currentJobId: null,
  isSubmitting: false,
  pollInterval: false,
  pollStartTime: 0,
  taskError: null,
  taskProgress: 0,
};

function uploadTaskReducer(
  state: UploadTaskState,
  action: UploadTaskAction,
): UploadTaskState {
  switch (action.type) {
    case 'reset':
      return initialTaskState;
    case 'submit_started':
      return {
        ...state,
        currentJobId: null,
        isSubmitting: true,
        pollInterval: false,
        taskError: null,
        taskProgress: 0,
      };
    case 'track_job':
      return {
        ...state,
        currentJobId: action.jobId,
        isSubmitting: true,
        pollInterval: TASK_POLL_INTERVAL_MS,
        pollStartTime: action.pollStartTime,
        taskError: null,
        taskProgress: action.progress ?? 0,
      };
    case 'progress':
      return { ...state, taskProgress: action.progress };
    case 'completed':
      return {
        ...state,
        currentJobId: null,
        isSubmitting: false,
        pollInterval: false,
        taskError: null,
        taskProgress: 0,
      };
    case 'failed':
    case 'timeout':
      return {
        ...state,
        currentJobId: null,
        isSubmitting: false,
        pollInterval: false,
        taskError: action.message,
      };
    case 'submit_failed':
      return {
        ...state,
        isSubmitting: false,
      };
    default:
      return state;
  }
}

function createSubmissionIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revokePreview(preview: string) {
  if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
}

class UserFacingUploadError extends Error {
  name = 'UserFacingUploadError';
}

export function useUploadWorkflow() {
  const t = useTranslations('upload');
  const tCommon = useTranslations('common');
  const errors = useTranslations('errors');
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const submitJobMutation = useSubmitImportJob();
  const [files, setFiles] = useState<UploadableFile[]>([]);
  const filesRef = useRef<UploadableFile[]>([]);
  const submissionKeyRef = useRef<string | null>(null);
  const [scoreName, setScoreName] = useState('');
  const [genres, setGenres] = useState<ScoreGenre[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [taskState, dispatchTask] = useReducer(
    uploadTaskReducer,
    initialTaskState,
  );
  const {
    currentJobId,
    isSubmitting,
    pollInterval,
    pollStartTime,
    taskError,
    taskProgress,
  } = taskState;
  const translateTaskError = useCallback(
    (codeOrMessage: string | null | undefined, fallback: string) => {
      if (!codeOrMessage) return fallback;
      if (errors.has(codeOrMessage as never))
        return errors(codeOrMessage as never);
      if (t.has(codeOrMessage as never)) return t(codeOrMessage as never);
      return fallback;
    },
    [errors, t],
  );

  const setTrackedFiles = useCallback(
    (
      next:
        | UploadableFile[]
        | ((current: UploadableFile[]) => UploadableFile[]),
    ) => {
      setFiles((current) => {
        const value = typeof next === 'function' ? next(current) : next;
        filesRef.current = value;
        return value;
      });
    },
    [],
  );

  const clearFiles = useCallback(() => {
    filesRef.current.forEach(({ preview }) => revokePreview(preview));
    setTrackedFiles([]);
    submissionKeyRef.current = null;
  }, [setTrackedFiles]);

  const appendFiles = useCallback(
    (acceptedFiles: File[]) => {
      submissionKeyRef.current = null;
      const additions = acceptedFiles.map<UploadableFile>((file) => ({
        file,
        preview: URL.createObjectURL(file),
        status: 'pending',
      }));
      setTrackedFiles((current) => [...current, ...additions]);
    },
    [setTrackedFiles],
  );

  const removeFile = useCallback(
    (index: number) => {
      submissionKeyRef.current = null;
      setTrackedFiles((current) => {
        const next = [...current];
        const [removed] = next.splice(index, 1);
        if (removed) revokePreview(removed.preview);
        return next;
      });
    },
    [setTrackedFiles],
  );

  const { data: statusResponse } = useImportJobDetail(currentJobId ?? '', {
    enabled: Boolean(currentJobId) && pollInterval !== false,
    refetchInterval: pollInterval,
  });

  useEffect(() => {
    const job = statusResponse;
    if (!job || !currentJobId) return;

    if (Date.now() - pollStartTime > TASK_WAIT_TIMEOUT_MS) {
      const description = t('processingTimeoutDesc');
      toast({
        title: t('processingTimeout'),
        description,
        variant: 'destructive',
      });
      dispatchTask({ type: 'timeout', message: description });
      return;
    }

    dispatchTask({ type: 'progress', progress: job.progress || 0 });
    const state = String(job.state).toUpperCase();
    if (state === 'PENDING_REVIEW' || state === 'CONFIRMED') {
      const completedScoreId = job.score_id;
      if (state === 'CONFIRMED' && !completedScoreId) {
        dispatchTask({ type: 'failed', message: t('taskProcessingFailed') });
        return;
      }
      dispatchTask({ type: 'completed' });
      clearFiles();
      router.push(getCompletedJobRoute(job.job_id, completedScoreId, state));
    } else if (state === 'FAILURE') {
      dispatchTask({
        type: 'failed',
        message: translateTaskError(job.public_code, t('taskProcessingFailed')),
      });
    }
  }, [
    clearFiles,
    currentJobId,
    pollStartTime,
    router,
    statusResponse,
    t,
    toast,
    translateTaskError,
  ]);

  useEffect(
    () => () => {
      filesRef.current.forEach(({ preview }) => revokePreview(preview));
    },
    [],
  );

  const startRecognition = useCallback(async () => {
    if (filesRef.current.length === 0) return;
    dispatchTask({ type: 'reset' });
    setIsUploading(true);

    try {
      const uploadIds: string[] = [];
      for (let index = 0; index < filesRef.current.length; index += 1) {
        const currentFile = filesRef.current[index];
        if (currentFile.status === 'uploaded' && currentFile.uploadId) {
          uploadIds.push(currentFile.uploadId);
          continue;
        }
        if (currentFile.file.size === 0) {
          const message = t('fileUnavailable', { name: currentFile.file.name });
          setTrackedFiles((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index
                ? { ...item, status: 'error', error: message }
                : item,
            ),
          );
          throw new UserFacingUploadError(message);
        }

        setTrackedFiles((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'uploading' } : item,
          ),
        );
        try {
          const response = await uploadsApi.createUpload(currentFile.file);
          const uploadId = response?.upload_id;
          if (!uploadId) throw new Error(tCommon('operationFailed'));
          uploadIds.push(uploadId);
          void queryClient.invalidateQueries({
            queryKey: queryKeys.storageUsage.current(),
          });
          setTrackedFiles((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index
                ? { ...item, status: 'uploaded', uploadId }
                : item,
            ),
          );
        } catch (error) {
          reportUnexpectedClientError(error, {
            area: 'upload',
            action: 'create_upload',
            file_index: index,
            file_size: currentFile.file.size,
          });
          const message = userFacingErrorMessage(
            errors,
            error,
            tCommon('operationFailed'),
          );
          setTrackedFiles((current) =>
            current.map((item, itemIndex) =>
              itemIndex === index
                ? { ...item, status: 'error', error: message }
                : item,
            ),
          );
          throw new UserFacingUploadError(message);
        }
      }

      setIsUploading(false);
      dispatchTask({ type: 'submit_started' });
      submissionKeyRef.current ??= createSubmissionIdempotencyKey();
      const response = await submitJobMutation.mutateAsync({
        uploadIds: uploadIds,
        idempotencyKey: submissionKeyRef.current,
        options: {
          title: scoreName || undefined,
          genres: knownGenres(genres),
        },
      });
      const jobId = response?.job_id;
      if (!jobId) throw new UserFacingUploadError(tCommon('operationFailed'));
      submissionKeyRef.current = null;
      dispatchTask({ type: 'track_job', jobId, pollStartTime: Date.now() });
      toast({ title: t('taskStarted'), description: t('taskStartedDesc') });
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'upload',
        action: 'start_recognition',
        file_count: filesRef.current.length,
      });
      const message =
        error instanceof UserFacingUploadError && error.message
          ? error.message
          : userFacingErrorMessage(errors, error, t('processingFailed'));
      toast({
        title: t('submitFailed'),
        description: message,
        variant: 'destructive',
      });
      setIsUploading(false);
      dispatchTask({ type: 'submit_failed' });
    }
  }, [
    errors,
    queryClient,
    scoreName,
    setTrackedFiles,
    submitJobMutation,
    t,
    genres,
    tCommon,
    toast,
  ]);

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
    setGenres,
    startRecognition,
    taskError,
    taskErrorMessage: taskError ?? '',
    taskProgress,
    genres,
  };
}
