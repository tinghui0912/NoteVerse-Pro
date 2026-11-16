// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http/customer-browser-transport';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { queryKeys } from '@/lib/query-client';
import { getCompletedJobRoute } from '@/lib/upload/upload-workflow';
import { useUploadWorkflow } from '@/hooks/upload/use-upload-workflow';
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

describe('upload score navigation', () => {
  it('routes review jobs and completed scores to their product pages', () => {
    expect(getCompletedJobRoute('review-job', null, 'READY_FOR_REVIEW')).toBe(
      '/review/review-job',
    );
    expect(
      getCompletedJobRoute('result-job', 'result-score', 'CONFIRMED'),
    ).toBe('/score/result-score');
  });
});

describe('upload error messages', () => {
  const tErrors = Object.assign(
    (key: never) => zhErrors[key as keyof typeof zhErrors],
    {
      has: (key: never) => Object.prototype.hasOwnProperty.call(zhErrors, key),
    },
  );

  it('maps storage quota errors to a user-facing message', () => {
    expect(
      translateErrorCode(tErrors, 'storage_quota_exceeded', '操作失败'),
    ).toBe('存储空间不足，请删除不需要的内容或升级方案。');
  });

  it('uses the fallback instead of exposing unknown backend codes', () => {
    expect(
      translateErrorCode(tErrors, 'unexpected_backend_code', '操作失败'),
    ).toBe('操作失败');
  });
});

describe('upload workflow storage quota handling', () => {
  it('marks the file and toast with the quota message when upload exceeds storage quota', async () => {
    createUploadMock.mockRejectedValue(
      new ApiError(422, 'storage_quota_exceeded', 'storage_quota_exceeded'),
    );
    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUploadWorkflow(), {
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
      queryKey: queryKeys.storageUsage.all,
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
    const { result } = renderHook(() => useUploadWorkflow(), {
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
      queryKey: queryKeys.storageUsage.all,
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: '识别请求已创建',
      description: uploadMessages.taskStartedDesc,
    });
  });
});
