// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';
import { getCompletedJobRoute } from '@/lib/upload/upload-workflow';
import { uploadErrorMessage } from '@/lib/upload/upload-error-message';
import { useUploadWorkflow } from '@/hooks/upload/use-upload-workflow';
import commonMessages from '@/../messages/zh/common.json';
import zhErrors from '@/../messages/zh/errors.json';
import uploadMessages from '@/../messages/zh/upload.json';

const uploadFileMock = vi.fn();
const submitImportJobMock = vi.fn();
const getImportJobMock = vi.fn();
const toastMock = vi.fn();
const pushMock = vi.fn();

vi.mock('@/lib/api', () => ({
  filesApi: {
    uploadFile: (...args: unknown[]) => uploadFileMock(...args),
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
  useSearchParams: () => new URLSearchParams(),
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
  uploadFileMock.mockReset();
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
    expect(getCompletedJobRoute('review-job', null, 'PENDING_REVIEW')).toBe('/review/review-job');
    expect(getCompletedJobRoute('result-job', 'result-score', 'CONFIRMED')).toBe('/score/result-score');
  });
});

describe('upload error messages', () => {
  const tErrors = Object.assign(
    (key: never) => zhErrors[key as keyof typeof zhErrors],
    {
      has: (key: never) => Object.prototype.hasOwnProperty.call(zhErrors, key),
    }
  );

  it('maps storage quota errors to a user-facing message', () => {
    expect(
      uploadErrorMessage(tErrors, 'storage_quota_exceeded', '操作失败')
    ).toBe('存储空间不足，请删除不需要的内容或升级方案。');
  });

  it('uses the fallback instead of exposing unknown backend codes', () => {
    expect(
      uploadErrorMessage(tErrors, 'unexpected_backend_code', '操作失败')
    ).toBe('操作失败');
  });
});

describe('upload workflow storage quota handling', () => {
  it('marks the file and toast with the quota message when upload exceeds storage quota', async () => {
    uploadFileMock.mockRejectedValue(
      new ApiError(
        422,
        'storage_quota_exceeded',
        'storage_quota_exceeded',
        { requested_bytes: 9 }
      )
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
      queryKey: queryKeys.storageUsage.current(),
    });
  });

  it('refreshes storage usage after a successful file upload', async () => {
    uploadFileMock.mockResolvedValue({
      success: true,
      data: { file_id: 'uploaded-file-id', filename: 'score.png', storage_key: 'scores/score.png', size: 3 },
    });
    submitImportJobMock.mockResolvedValue({
      success: true,
      data: { job_id: 'job-1' },
    });
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

    expect(uploadFileMock).toHaveBeenCalledTimes(1);
    expect(submitImportJobMock).toHaveBeenCalledWith(
      ['uploaded-file-id'],
      { title: undefined, taxonomy_tags: [] },
      'upload-workflow-test-key'
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.storageUsage.current(),
    });
    expect(toastMock).toHaveBeenCalledWith({
      title: '任务已创建，等待处理',
      description: '后台服务恢复后会自动处理。你可以保持本页打开，也可以稍后到我的乐谱库查看结果。',
    });
  });
});
