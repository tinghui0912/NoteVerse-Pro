// @vitest-environment jsdom
import { storageUsageQueryKeys } from '@/features/storage-usage/query-keys';
import { importQueryKeys } from '@/features/imports/query-keys';

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { translateErrorCode, userFacingErrorMessage } from '@/lib/i18n/error-message';
import * as navigation from '@/features/imports/routes';
import type { ImportJobRead } from '@/generated/api';
import { useImportUploadWorkflow } from '@/features/imports/submission/use-import-upload-workflow';
import commonMessages from '@/../messages/zh/common.json';
import zhErrors from '@/../messages/zh/errors.json';
import uploadMessages from '@/../messages/zh/upload.json';
import { scoreGenresForDisplay } from '@/lib/score/genres';

const createUploadMock = vi.fn();
const submitImportJobMock = vi.fn();
const getImportJobMock = vi.fn();
const toastMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/lib/api', () => ({
  uploadsApi: {
    createUpload: (...args: unknown[]) => createUploadMock(...args),
  },
}));

vi.mock('@/features/imports/api/jobs', () => ({
  importJobsApi: {
    getImportJob: (...args: unknown[]) => getImportJobMock(...args),
    submitImportJob: (...args: unknown[]) => submitImportJobMock(...args),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider
          locale="zh"
          messages={{
            common: commonMessages,
            errors: zhErrors,
            upload: uploadMessages,
          }}
        >
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function selectedImage(name = 'score.png') {
  return new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
}

beforeEach(() => {
  createUploadMock.mockReset();
  submitImportJobMock.mockReset();
  getImportJobMock.mockReset();
  toastMock.mockReset();
  pushMock.mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => 'upload-workflow-test-key' });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:score-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('upload terminal navigation', () => {
  it.each([
    ['READY_FOR_REVIEW', null, '/imports/job-1/review'],
    ['CONFIRMED', 'live-score', '/score/live-score'],
    ['CONFIRMED', null, '/upload#import-activity'],
    ['CONFIRMED', undefined, '/upload#import-activity'],
  ] satisfies [ImportJobRead['state'], string | null | undefined, string][])(
    'finishes %s with score %s at %s', async (state, score_id, href) => {
      createUploadMock.mockResolvedValue({ upload_id: 'upload-1' });
      submitImportJobMock.mockResolvedValue({ job_id: 'job-1' });
      const job = { job_id: 'job-1', state, score_id, progress: 100 };
      getImportJobMock.mockResolvedValue(job);
      const resolve = vi.spyOn(navigation, 'importJobDestination');
      const client = createQueryClient();
      const hook = renderHook(() => useImportUploadWorkflow(), { wrapper: createWrapper(client) });
      act(() => hook.result.current.appendFiles([selectedImage()]));
      await act(async () => { await hook.result.current.startRecognition(); });
      await waitFor(() => expect(pushMock).toHaveBeenCalledWith(href));
      expect(resolve).toHaveBeenCalledWith(job);
      expect(pushMock).toHaveBeenCalledTimes(1);
      expect(hook.result.current.isProcessing).toBe(false);
      expect(hook.result.current.taskError).toBeNull();
      expect(hook.result.current.files).toHaveLength(0);
      expect(client.getQueryCache().find({ queryKey: importQueryKeys.jobs.detail('job-1') })?.isActive()).toBe(false);
      hook.unmount();
      client.clear();
    },
  );

  it.each(['QUEUED', 'PROCESSING'] satisfies ImportJobRead['state'][])(
    'continues polling %s without navigation', async (state) => {
      createUploadMock.mockResolvedValue({ upload_id: 'upload-1' });
      submitImportJobMock.mockResolvedValue({ job_id: 'job-1' });
      getImportJobMock.mockResolvedValue({ job_id: 'job-1', state, progress: 37 });
      const client = createQueryClient();
      const hook = renderHook(() => useImportUploadWorkflow(), { wrapper: createWrapper(client) });
      act(() => hook.result.current.appendFiles([selectedImage()]));
      await act(async () => { await hook.result.current.startRecognition(); });
      await waitFor(() => expect(hook.result.current.taskProgress).toBe(37));
      expect(hook.result.current.isProcessing).toBe(true);
      expect(client.getQueryCache().find({ queryKey: importQueryKeys.jobs.detail('job-1') })?.isActive()).toBe(true);
      expect(pushMock).not.toHaveBeenCalled();
      hook.unmount();
      client.clear();
    },
  );
});

describe('upload error messages', () => {
  const tErrors = Object.assign(
    (key: keyof typeof zhErrors) => zhErrors[key as keyof typeof zhErrors],
    {
      has: (key: keyof typeof zhErrors) => Object.prototype.hasOwnProperty.call(zhErrors, key),
    },
  );

  it('maps storage quota errors to a user-facing message', () => {
    expect(translateErrorCode(tErrors, 'storage_quota_exceeded', '操作失败')).toBe(
      '存储空间不足，请删除不需要的内容或升级方案。',
    );
  });

  it('uses the fallback instead of exposing unknown backend codes', () => {
    expect(userFacingErrorMessage(tErrors, { code: 'unexpected_backend_code' }, '操作失败')).toBe(
      '操作失败',
    );
  });
});

describe('upload workflow storage quota handling', () => {
  it('marks the file and toast with the quota message when upload exceeds storage quota', async () => {
    createUploadMock.mockRejectedValue(
      new ApiError(422, 'storage_quota_exceeded', 'storage_quota_exceeded'),
    );
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useImportUploadWorkflow(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.appendFiles([selectedImage()]);
    });
    await act(async () => {
      await result.current.startRecognition();
    });

    expect(result.current.files[0]).toMatchObject({
      status: 'error',
      error: '存储空间不足，请删除不需要的内容或升级方案。',
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: '提交失败',
      description: '存储空间不足，请删除不需要的内容或升级方案。',
      variant: 'destructive',
    });
    expect(submitImportJobMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalledWith({
      queryKey: storageUsageQueryKeys.all,
    });
  });

  it('refreshes storage usage after a successful file upload', async () => {
    createUploadMock.mockResolvedValue({
      upload_id: 'uploaded-upload-id',
      original_filename: 'score.png',
      byte_size: 3,
    });
    submitImportJobMock.mockResolvedValue({ job_id: 'job-1' });
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useImportUploadWorkflow(), {
      wrapper: createWrapper(queryClient),
    });

    act(() => {
      result.current.appendFiles([selectedImage()]);
      result.current.setGenres([...scoreGenresForDisplay]);
    });
    await act(async () => {
      await result.current.startRecognition();
    });

    expect(createUploadMock).toHaveBeenCalledTimes(1);
    expect(submitImportJobMock).toHaveBeenCalledWith(
      ['uploaded-upload-id'],
      { title: undefined, genres: [...scoreGenresForDisplay] },
      'upload-workflow-test-key',
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: storageUsageQueryKeys.all,
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: '识别请求已创建',
      description: uploadMessages.taskStartedDesc,
    });
  });
});
