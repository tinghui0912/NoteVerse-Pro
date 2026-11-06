// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyPerformancesPage from './page';
import type {
  PerformanceTakeRead,
  RecordingTimebase,
  PerformanceTakeTempoPlan,
} from '@/lib/api/performance-takes';
function pageParams(page: string): Promise<{
  page: string;
}> & {
  page: string;
} {
  return Object.assign(Promise.resolve({ page }), { page });
}
const mockRouterPush = vi.fn();
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));
const translationMocks = vi.hoisted(() => {
  const practice: Record<string, string> = {
    myPerformances: '我的演奏',
    videoExportOpenAction: '导出乐谱视频',
    noPerformancesTitle: '暂无已保存的演奏',
    noPerformancesDesc:
      '在连贯演奏结束后，点击“保存演奏”，你的录音就会保存在这里。',
    deletePerformanceTake: '删除演奏',
    deletePerformanceTakeConfirmTitle: '确定要删除这条演奏记录吗？',
    deletePerformanceTakeConfirmDesc:
      '删除后，该录音将从云端永久移除，无法恢复。',
    takeDeletingStatus: '删除中',
    deletePerformanceTakeAcceptedTitle: '删除请求已接受',
    deletePerformanceTakeAcceptedDesc:
      '删除请求已接受，正在后台清理并释放配额。',
    deleteStillProcessingTitle: '删除仍在后台处理中',
    deleteStillProcessingDesc:
      '对象存储和配额清理还没有完成。你可以稍后刷新，页面会继续自动更新。',
    downloadRecording: '下载录音',
    downloadVideo: '下载视频',
    performanceTakeDeleted: '已删除该演奏',
    performanceDuration: '演奏时长',
    performanceScope: '练习范围',
    performanceTempo: '演奏速度',
    performanceInput: '输入方式',
    inputSourceMic: '麦克风 (Acoustic)',
    scopeFull: '全曲演奏',
    scopeSection: '选段演奏',
    scoreFallback: '乐谱 #{id}',
    pagination: '第 {page} / {totalPages} 页',
    previousPage: '上一页',
    nextPage: '下一页',
    takeScopeBeats: '第 {start} - {end} 拍',
    audioPlaybackFailed: '本次录音不可回放',
    tempoScoreMode: '原谱速度',
    tempoScoreModeWithBpm: '原谱速度 (♩ = {bpm})',
    tempoScoreModeVariable: '原谱速度 (变化速度)',
    downloadFailedRetry: '下载录音失败，请重试',
    deleteFailedRetry: '删除演奏失败，请重试',
  };
  const common: Record<string, string> = {
    play: '播放',
    playing: '播放中',
    delete: '删除',
    cancel: '取消',
    loading: '加载中...',
    tryAgain: '重试',
    refresh: '刷新',
    loadFailedDescription: '暂时无法加载内容，请稍后重试。',
  };
  function createTranslator(dict: Record<string, string>) {
    const t = (key: string, values?: Record<string, string | number>) => {
      const template = dict[key] ?? key;
      return Object.entries(values ?? {}).reduce(
        (message, [name, val]) => message.replace(`{${name}}`, String(val)),
        template,
      );
    };
    t.has = (key: string) => Object.prototype.hasOwnProperty.call(dict, key);
    return t;
  }
  return {
    practice: createTranslator(practice),
    common: createTranslator(common),
  };
});
vi.mock('next-intl', () => ({
  useLocale: () => 'zh',
  useTranslations: (namespace?: string) => {
    if (namespace === 'common') return translationMocks.common;
    return translationMocks.practice;
  },
}));
vi.mock('@/i18n/routing', () => ({
  Link: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: mockRouterPush }),
  usePathname: () => '/my-performances',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush }),
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock('@/components/practice/performance-replay-player', () => ({
  PerformanceReplayPlayer: ({
    replay,
  }: {
    replay: {
      kind?: string;
      url?: string;
    };
  }) => (
    <div data-testid="performance-replay-player">
      <span>Kind: {replay.kind}</span>
      <span>Replaying: {replay.url}</span>
    </div>
  ),
}));
const mockDeleteTakeMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn().mockResolvedValue({ data: { deleted: true } }),
  isPending: false,
}));
const mockPlaybackQuery = vi.hoisted(() => ({
  data: {
    data: {
      take_id: 'take-1',
      playback_url: 'https://oss.example.com/play-1.webm',
      download_url: 'https://oss.example.com/download-1.webm',
      media_kind: 'AUDIO',
      media_mime_type: 'audio/webm',
      media_byte_size: 1024,
      expires_in: 3600,
    },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));
const tempoPlan: PerformanceTakeTempoPlan = {
  selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 },
  segments: [{ startTick: 0, bpm: 120, source: 'CUSTOM' }],
};
const recordingTimebase: RecordingTimebase = {
  nominalMediaDurationUs: 30000000,
  activeSegments: [
    {
      performanceStartUs: 0,
      performanceEndUs: 30000000,
      mediaStartUs: 0,
      mediaEndUs: 30000000,
    },
  ],
};
// 121 fixture items
const fixture121Takes: PerformanceTakeRead[] = Array.from(
  { length: 121 },
  (_, i) => ({
    archive_media: { mime_type: 'audio/webm', byte_size: 1024 * (i + 1) },
    deletion_status: 'ACTIVE',
    take_id: `take-${i + 1}`,
    created_at: new Date(1700000000000 - i * 60000).toISOString(),
    manifest: {
      artifact_id: `artifact-${i + 1}`,
      score_title_snapshot: `Score Title ${i + 1}`,
      score_timebase: { ticks_per_quarter: 1 },
      tempo_plan: tempoPlan,
      recording_timebase: recordingTimebase,
      practice_binding: {
        bundle_id: 'source-1',
        score_id: `score-uuid-${i + 1}`,
        revision_id: `rev-uuid-${i + 1}`,
      },
      capture: {
        kind: 'AUDIO',
        mime_type: 'audio/webm',
        byte_size: 1024 * (i + 1),
      },
      scope:
        i % 2 === 0
          ? { kind: 'FULL', start_tick: 0, terminal_tick: 16 }
          : {
              kind: 'RANGE',
              start_tick: 4,
              terminal_tick: 16,
              start_group_id: 'group-1',
              end_group_id: 'group-2',
            },
    },
  }),
);
let currentTakesTotal = 121;
interface MockTakesQueryResult {
  data?: {
    data: {
      items: PerformanceTakeRead[];
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
    };
  } | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => unknown;
}
let mockQueryOverride: MockTakesQueryResult | null = null;
let mockReactiveQueryResponses: MockTakesQueryResult[] | null = null;
let mockReactiveQueryIndex = 0;
let mockReactiveQueryVersion = 0;
const mockReactiveQueryListeners = new Set<() => void>();
function subscribeToReactiveQuery(listener: () => void) {
  mockReactiveQueryListeners.add(listener);
  return () => mockReactiveQueryListeners.delete(listener);
}
function getReactiveQuerySnapshot() {
  return mockReactiveQueryVersion;
}
function notifyReactiveQuery() {
  mockReactiveQueryVersion += 1;
  mockReactiveQueryListeners.forEach((listener) => listener());
}
function enableReactiveQueryResponses(responses: MockTakesQueryResult[]) {
  mockReactiveQueryResponses = responses;
  mockReactiveQueryIndex = 0;
  notifyReactiveQuery();
}
const mockUsePerformanceTakes = vi.fn(
  (params?: { limit?: number; offset?: number }) => {
    if (mockReactiveQueryResponses) {
      React.useSyncExternalStore(
        subscribeToReactiveQuery,
        getReactiveQuerySnapshot,
        getReactiveQuerySnapshot,
      );
      const response =
        mockReactiveQueryResponses[
          Math.min(
            mockReactiveQueryIndex,
            mockReactiveQueryResponses.length - 1,
          )
        ];
      return {
        ...response,
        refetch: vi.fn(async () => {
          if (
            mockReactiveQueryResponses &&
            mockReactiveQueryIndex < mockReactiveQueryResponses.length - 1
          ) {
            mockReactiveQueryIndex += 1;
            notifyReactiveQuery();
          }
          return (
            mockReactiveQueryResponses?.[mockReactiveQueryIndex] ?? response
          );
        }),
      };
    }
    if (mockQueryOverride) return mockQueryOverride;
    const limit = params?.limit ?? 20;
    const offset = params?.offset ?? 0;
    const items = fixture121Takes
      .slice(0, currentTakesTotal)
      .slice(offset, offset + limit);
    return {
      data: {
        data: {
          items,
          total: currentTakesTotal,
          limit,
          offset,
          has_more: offset + limit < currentTakesTotal,
        },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
  },
);
vi.mock('@/hooks/queries/use-performance-take-queries', () => ({
  usePerformanceTakes: (params?: { limit?: number; offset?: number }) =>
    mockUsePerformanceTakes(params),
  useDeletePerformanceTake: () => mockDeleteTakeMutation,
  usePerformanceTakePlayback: (takeId: string, enabled: boolean) => {
    if (!enabled) {
      return { data: null, isLoading: false, isError: false, refetch: vi.fn() };
    }
    return mockPlaybackQuery;
  },
}));
const mockApi = vi.hoisted(() => ({
  getPlaybackUrl: vi.fn().mockResolvedValue({
    data: {
      playback_url: 'https://oss.example.com/play-1.webm',
      download_url: 'https://oss.example.com/download-1.webm',
    },
  }),
}));
vi.mock('@/lib/api/performance-takes', () => ({
  performanceTakesApi: mockApi,
}));
describe('MyPerformancesPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryOverride = null;
    mockReactiveQueryResponses = null;
    mockReactiveQueryIndex = 0;
    mockReactiveQueryListeners.clear();
    mockReactiveQueryVersion = 0;
    currentTakesTotal = 121;
    mockPlaybackQuery.isLoading = false;
    mockPlaybackQuery.isError = false;
    mockPlaybackQuery.data.data.media_kind = 'AUDIO';
    mockPlaybackQuery.data.data.media_mime_type = 'audio/webm';
    mockDeleteTakeMutation.isPending = false;
  });
  it('renders loading state', () => {
    mockQueryOverride = {
      data: null,
      isLoading: true,
      isError: false,
      isSuccess: false,
      refetch: vi.fn(),
    };
    render(<MyPerformancesPage />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });
  it('renders error state with retry button', () => {
    const refetch = vi.fn();
    mockQueryOverride = {
      data: null,
      isLoading: false,
      isError: true,
      isSuccess: false,
      refetch,
    };
    render(<MyPerformancesPage />);
    expect(
      screen.getByText('暂时无法加载内容，请稍后重试。'),
    ).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: '重试' });
    fireEvent.click(retryBtn);
    expect(refetch).toHaveBeenCalled();
  });
  it('renders empty state when no takes exist', () => {
    currentTakesTotal = 0;
    render(<MyPerformancesPage />);
    expect(screen.getByText('暂无已保存的演奏')).toBeInTheDocument();
  });
  it('renders retained score provenance as a score link', () => {
    mockQueryOverride = {
      data: {
        data: {
          items: [
            {
              archive_media: { mime_type: 'audio/webm', byte_size: 1024 },
              take_id: 'take-deleted-score',
              linked_score_id: 'score-retained-source',
              can_open_score: true,
              created_at: new Date().toISOString(),
              manifest: {
                artifact_id: 'artifact-1',
                score_title_snapshot: 'Sonata Allegro Op. 57',
                score_timebase: { ticks_per_quarter: 1 },
                tempo_plan: tempoPlan,
                recording_timebase: recordingTimebase,
                practice_binding: {
                  bundle_id: 'source-1',
                  score_id: 'score-retained-source',
                  revision_id: 'revision-1',
                },
                capture: {
                  kind: 'AUDIO',
                  mime_type: 'audio/webm',
                  byte_size: 1024,
                },
                scope: {
                  kind: 'FULL',
                  start_tick: 0,
                  terminal_tick: 0,
                },
              },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    render(<MyPerformancesPage />);
    const scoreLink = screen.getByRole('link', { name: /Sonata Allegro/ });
    expect(scoreLink).toBeInTheDocument();
    expect(scoreLink).toHaveAttribute('href', '/score/score-retained-source');
    expect(screen.queryByText('原乐谱已删除')).not.toBeInTheDocument();
  });
  it('renders retained score provenance as plain text when live score is no longer accessible', () => {
    mockQueryOverride = {
      data: {
        data: {
          items: [
            {
              archive_media: { mime_type: 'audio/webm', byte_size: 1024 },
              take_id: 'take-deleted-score',
              linked_score_id: null,
              can_open_score: false,
              created_at: new Date().toISOString(),
              manifest: {
                artifact_id: 'artifact-1',
                score_title_snapshot: 'Sonata Allegro Op. 57',
                score_timebase: { ticks_per_quarter: 1 },
                tempo_plan: tempoPlan,
                recording_timebase: recordingTimebase,
                practice_binding: {
                  bundle_id: 'source-1',
                  score_id: 'score-retained-source',
                  revision_id: 'revision-1',
                },
                capture: {
                  kind: 'AUDIO',
                  mime_type: 'audio/webm',
                  byte_size: 1024,
                },
                scope: {
                  kind: 'FULL',
                  start_tick: 0,
                  terminal_tick: 0,
                },
              },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    render(<MyPerformancesPage />);
    expect(screen.getByText('Sonata Allegro Op. 57')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Sonata Allegro/ }),
    ).not.toBeInTheDocument();
  });
  it('handles playback toggling and playback error retry', () => {
    mockQueryOverride = {
      data: {
        data: {
          items: [
            {
              archive_media: { mime_type: 'audio/webm', byte_size: 1024 },
              take_id: 'take-1',
              created_at: new Date().toISOString(),
              manifest: {
                artifact_id: 'artifact-1',
                score_title_snapshot: 'Score Title 1',
                score_timebase: { ticks_per_quarter: 1 },
                tempo_plan: tempoPlan,
                recording_timebase: recordingTimebase,
                practice_binding: {
                  bundle_id: 'source-1',
                  score_id: 'score-uuid-1',
                  revision_id: 'revision-1',
                },
                capture: {
                  kind: 'AUDIO',
                  mime_type: 'audio/webm',
                  byte_size: 1024,
                },
                scope: {
                  kind: 'FULL',
                  start_tick: 0,
                  terminal_tick: 0,
                },
              },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    const { rerender } = render(<MyPerformancesPage />);
    const playBtn = screen.getByTestId('play-take-take-1');
    fireEvent.click(playBtn);
    expect(screen.getByTestId('performance-replay-player')).toBeInTheDocument();
    expect(
      screen.getByText('Replaying: https://oss.example.com/play-1.webm'),
    ).toBeInTheDocument();
    // Playback error handling
    mockPlaybackQuery.isError = true;
    rerender(<MyPerformancesPage />);
    expect(screen.getByText('本次录音不可回放')).toBeInTheDocument();
    const retryBtn = screen.getByTestId('retry-playback-take-1');
    fireEvent.click(retryBtn);
    expect(mockPlaybackQuery.refetch).toHaveBeenCalled();
  });
  it.each(['video/webm', 'video/mp4'])(
    'offers %s raw video replay/download and the local video export route',
    async (mimeType) => {
      mockQueryOverride = {
        data: {
          data: {
            items: [
              {
                archive_media: { mime_type: mimeType, byte_size: 2048 },
                take_id: 'take-video-1',
                created_at: new Date().toISOString(),
                manifest: {
                  artifact_id: 'artifact-1',
                  score_title_snapshot: 'Score Title 1',
                  score_timebase: { ticks_per_quarter: 1 },
                  tempo_plan: tempoPlan,
                  recording_timebase: recordingTimebase,
                  practice_binding: {
                    bundle_id: 'source-1',
                    score_id: 'score-uuid-1',
                    revision_id: 'revision-1',
                  },
                  capture: {
                    kind: 'VIDEO',
                    mime_type: mimeType,
                    byte_size: 2048,
                  },
                  scope: {
                    kind: 'FULL',
                    start_tick: 0,
                    terminal_tick: 16,
                  },
                },
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
            has_more: false,
          },
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch: vi.fn(),
      };
      mockPlaybackQuery.data.data.media_kind = 'VIDEO';
      mockPlaybackQuery.data.data.media_mime_type = mimeType;
      render(<MyPerformancesPage />);
      expect(
        screen.getByTestId('download-take-take-video-1'),
      ).toHaveTextContent('下载视频');
      expect(
        screen.getByTestId('video-export-take-take-video-1'),
      ).toHaveAttribute('href', '/my-performances/take-video-1/video-export');
      expect(
        screen.getByTestId('video-export-take-take-video-1'),
      ).toHaveTextContent('导出乐谱视频');
      fireEvent.click(screen.getByTestId('play-take-take-video-1'));
      expect(screen.getByText('Kind: VIDEO_RECORDING')).toBeInTheDocument();
      const extension = mimeType === 'video/mp4' ? 'mp4' : 'webm';
      mockApi.getPlaybackUrl.mockResolvedValueOnce({
        data: {
          playback_url: `https://oss.example.com/raw.${extension}`,
          download_url: `https://oss.example.com/raw.${extension}`,
          media_kind: 'VIDEO',
          media_mime_type: mimeType,
        },
      });
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      try {
        fireEvent.click(screen.getByTestId('download-take-take-video-1'));
        await waitFor(() => expect(click).toHaveBeenCalledOnce());
        expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
          `performance-take-video-1.${extension}`,
        );
      } finally {
        click.mockRestore();
      }
    },
  );
  it('triggers download and handles download failure with retry', async () => {
    mockQueryOverride = {
      data: {
        data: {
          items: [
            {
              archive_media: { mime_type: 'audio/webm', byte_size: 1024 },
              take_id: 'take-1',
              created_at: new Date().toISOString(),
              manifest: {
                artifact_id: 'artifact-1',
                score_title_snapshot: 'Score Title 1',
                score_timebase: { ticks_per_quarter: 1 },
                tempo_plan: tempoPlan,
                recording_timebase: recordingTimebase,
                practice_binding: {
                  bundle_id: 'source-1',
                  score_id: 'score-uuid-1',
                  revision_id: 'revision-1',
                },
                capture: {
                  kind: 'AUDIO',
                  mime_type: 'audio/webm',
                  byte_size: 1024,
                },
                scope: {
                  kind: 'FULL',
                  start_tick: 0,
                  terminal_tick: 0,
                },
              },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    render(<MyPerformancesPage />);
    const downloadBtn = screen.getByTestId('download-take-take-1');
    fireEvent.click(downloadBtn);
    await waitFor(() => {
      expect(mockApi.getPlaybackUrl).toHaveBeenCalledWith('take-1');
    });
    await waitFor(() => expect(downloadBtn).toBeEnabled());
    // Failure simulation
    mockApi.getPlaybackUrl.mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(downloadBtn);
    await waitFor(() => {
      expect(screen.getByTestId('download-error-take-1')).toBeInTheDocument();
      expect(screen.getByText('下载录音失败，请重试')).toBeInTheDocument();
    });
    // Retry
    mockApi.getPlaybackUrl.mockResolvedValueOnce({
      data: {
        playback_url: 'https://oss.example.com/play-1.webm',
        download_url: 'https://oss.example.com/download-1.webm',
      },
    });
    const retryBtn = screen.getByTestId('retry-download-take-1');
    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(mockApi.getPlaybackUrl).toHaveBeenCalledTimes(3);
    });
  });
  it('opens confirmation dialog and handles delete failure with retry', async () => {
    mockQueryOverride = {
      data: {
        data: {
          items: [
            {
              archive_media: { mime_type: 'audio/webm', byte_size: 1024 },
              take_id: 'take-1',
              created_at: new Date().toISOString(),
              manifest: {
                artifact_id: 'artifact-1',
                score_title_snapshot: 'Score Title 1',
                score_timebase: { ticks_per_quarter: 1 },
                tempo_plan: tempoPlan,
                recording_timebase: recordingTimebase,
                practice_binding: {
                  bundle_id: 'source-1',
                  score_id: 'score-uuid-1',
                  revision_id: 'revision-1',
                },
                capture: {
                  kind: 'AUDIO',
                  mime_type: 'audio/webm',
                  byte_size: 1024,
                },
                scope: {
                  kind: 'FULL',
                  start_tick: 0,
                  terminal_tick: 0,
                },
              },
            },
          ],
          total: 1,
          limit: 20,
          offset: 0,
          has_more: false,
        },
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    };
    render(<MyPerformancesPage />);
    const deleteBtn = screen.getByTestId('delete-take-take-1');
    fireEvent.click(deleteBtn);
    expect(screen.getByText('确定要删除这条演奏记录吗？')).toBeInTheDocument();
    // 1. Simulate failure
    mockDeleteTakeMutation.mutateAsync.mockRejectedValueOnce(
      new Error('Delete failed'),
    );
    const confirmBtn = screen.getByTestId('confirm-delete-take-button');
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(screen.getByTestId('delete-take-error')).toBeInTheDocument();
      expect(screen.getByText('删除演奏失败，请重试')).toBeInTheDocument();
    });
    // Dialog stays open
    expect(screen.getByText('确定要删除这条演奏记录吗？')).toBeInTheDocument();
    // 2. Retry with success
    mockDeleteTakeMutation.mutateAsync.mockResolvedValueOnce({
      data: { deleted: true },
    });
    fireEvent.click(confirmBtn);
    await waitFor(() => {
      expect(mockDeleteTakeMutation.mutateAsync).toHaveBeenCalledWith('take-1');
    });
    await waitFor(() => {
      expect(
        screen.queryByText('确定要删除这条演奏记录吗？'),
      ).not.toBeInTheDocument();
    });
  });
  describe('121+ Items Pagination Verification (Pages 1, 2, and 7)', () => {
    it('verifies Page 1: limit=20, offset=0, items 1-20, canGoPrevious=false, canGoNext=true', () => {
      render(<MyPerformancesPage searchParams={pageParams('1')} />);
      expect(mockUsePerformanceTakes).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
      });
      // Renders items 1 through 20
      expect(screen.getByText('Score Title 1')).toBeInTheDocument();
      expect(screen.getByText('Score Title 20')).toBeInTheDocument();
      expect(screen.queryByText('Score Title 21')).not.toBeInTheDocument();
      // Pagination indicator: Page 1 of 7
      expect(screen.getByText('第 1 / 7 页')).toBeInTheDocument();
      const prevBtn = screen.getByRole('button', { name: '上一页' });
      const nextBtn = screen.getByRole('button', { name: '下一页' });
      expect(prevBtn).toBeDisabled();
      expect(nextBtn).toBeEnabled();
      fireEvent.click(nextBtn);
      expect(mockRouterPush).toHaveBeenCalledWith('?page=2');
    });
    it('verifies Page 2: limit=20, offset=20, items 21-40, canGoPrevious=true, canGoNext=true', () => {
      render(<MyPerformancesPage searchParams={pageParams('2')} />);
      expect(mockUsePerformanceTakes).toHaveBeenCalledWith({
        limit: 20,
        offset: 20,
      });
      // Renders items 21 through 40
      expect(screen.queryByText('Score Title 20')).not.toBeInTheDocument();
      expect(screen.getByText('Score Title 21')).toBeInTheDocument();
      expect(screen.getByText('Score Title 40')).toBeInTheDocument();
      expect(screen.queryByText('Score Title 41')).not.toBeInTheDocument();
      expect(screen.getByText('第 2 / 7 页')).toBeInTheDocument();
      const prevBtn = screen.getByRole('button', { name: '上一页' });
      const nextBtn = screen.getByRole('button', { name: '下一页' });
      expect(prevBtn).toBeEnabled();
      expect(nextBtn).toBeEnabled();
      fireEvent.click(prevBtn);
      expect(mockRouterPush).toHaveBeenCalledWith('/my-performances');
      fireEvent.click(nextBtn);
      expect(mockRouterPush).toHaveBeenCalledWith('?page=3');
    });
    it('verifies Page 7: limit=20, offset=120, item 121 (last item), canGoPrevious=true, canGoNext=false', () => {
      render(<MyPerformancesPage searchParams={pageParams('7')} />);
      expect(mockUsePerformanceTakes).toHaveBeenCalledWith({
        limit: 20,
        offset: 120,
      });
      // Exactly 1 item on Page 7
      expect(screen.getByText('Score Title 121')).toBeInTheDocument();
      expect(screen.queryByText('Score Title 120')).not.toBeInTheDocument();
      expect(screen.getByText('第 7 / 7 页')).toBeInTheDocument();
      const prevBtn = screen.getByRole('button', { name: '上一页' });
      const nextBtn = screen.getByRole('button', { name: '下一页' });
      expect(prevBtn).toBeEnabled();
      expect(nextBtn).toBeDisabled();
      fireEvent.click(prevBtn);
      expect(mockRouterPush).toHaveBeenCalledWith('?page=6');
    });
    it('normalizes illegal and negative query parameters to Page 1', () => {
      render(<MyPerformancesPage searchParams={pageParams('invalid')} />);
      expect(mockUsePerformanceTakes).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
      });
      render(<MyPerformancesPage searchParams={pageParams('-5')} />);
      expect(mockUsePerformanceTakes).toHaveBeenCalledWith({
        limit: 20,
        offset: 0,
      });
    });
    it('redirects to max valid page when URL page exceeds total pages', async () => {
      render(<MyPerformancesPage searchParams={pageParams('99')} />);
      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith('?page=7');
      });
    });
    it('adjusts total and page when last item on page is deleted', async () => {
      currentTakesTotal = 121;
      const { rerender } = render(
        <MyPerformancesPage searchParams={pageParams('7')} />,
      );
      expect(screen.getByText('Score Title 121')).toBeInTheDocument();
      const deleteBtn = screen.getByTestId('delete-take-take-121');
      fireEvent.click(deleteBtn);
      const confirmBtn = screen.getByTestId('confirm-delete-take-button');
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockDeleteTakeMutation.mutateAsync).toHaveBeenCalledWith(
          'take-121',
        );
      });
      // Total drops to 120 (6 pages)
      currentTakesTotal = 120;
      rerender(<MyPerformancesPage searchParams={pageParams('7')} />);
      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith('?page=6');
      });
    });
    it('resets playing audio when changing page', () => {
      const { rerender } = render(
        <MyPerformancesPage searchParams={pageParams('1')} />,
      );
      const playBtn = screen.getByTestId('play-take-take-1');
      fireEvent.click(playBtn);
      expect(
        screen.getByTestId('performance-replay-player'),
      ).toBeInTheDocument();
      // Page change stops playback
      rerender(<MyPerformancesPage searchParams={pageParams('2')} />);
      expect(
        screen.queryByTestId('performance-replay-player'),
      ).not.toBeInTheDocument();
    });
    it('labels saved ranges without requiring a detached source timebase', () => {
      render(<MyPerformancesPage searchParams={pageParams('1')} />);
      // Range item: scope_start_tick = 4, scope_terminal_tick = 16
      expect(screen.getAllByText('选段演奏').length).toBeGreaterThan(0);
      // Full item:
      expect(screen.getAllByText('全曲演奏').length).toBeGreaterThan(0);
    });
    it('renders deleting badge and disables actions when take is in DELETING status', () => {
      mockQueryOverride = {
        data: {
          data: {
            items: [
              {
                ...fixture121Takes[0],
                take_id: 'take-deleting-1',
                deletion_status: 'DELETING' as const,
              },
            ],
            total: 1,
            limit: 20,
            offset: 0,
            has_more: false,
          },
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch: vi.fn(),
      };
      render(<MyPerformancesPage searchParams={pageParams('1')} />);
      // Badge visible
      expect(
        screen.getByTestId('deleting-badge-take-deleting-1'),
      ).toBeInTheDocument();
      expect(screen.getByText('删除中')).toBeInTheDocument();
      // Action buttons disabled
      expect(screen.getByTestId('play-take-take-deleting-1')).toBeDisabled();
      expect(
        screen.getByTestId('download-take-take-deleting-1'),
      ).toBeDisabled();
      expect(screen.getByTestId('delete-take-take-deleting-1')).toBeDisabled();
      mockQueryOverride = null;
    });
    it('polls after DELETE 202, keeps processing state while backend returns DELETING, then removes the card', async () => {
      vi.useFakeTimers();
      const activeTake = {
        ...fixture121Takes[0],
        take_id: 'take-delete-flow',
        deletion_status: 'ACTIVE' as const,
        manifest: {
          ...fixture121Takes[0].manifest,
          score_title_snapshot: 'Delete Flow',
        },
      };
      const deletingTake = {
        ...activeTake,
        deletion_status: 'DELETING' as const,
      };
      enableReactiveQueryResponses([
        {
          data: {
            data: {
              items: [activeTake],
              total: 1,
              limit: 20,
              offset: 0,
              has_more: false,
            },
          },
          isLoading: false,
          isError: false,
          isSuccess: true,
          refetch: vi.fn(),
        },
        {
          data: {
            data: {
              items: [deletingTake],
              total: 1,
              limit: 20,
              offset: 0,
              has_more: false,
            },
          },
          isLoading: false,
          isError: false,
          isSuccess: true,
          refetch: vi.fn(),
        },
        {
          data: {
            data: {
              items: [],
              total: 0,
              limit: 20,
              offset: 0,
              has_more: false,
            },
          },
          isLoading: false,
          isError: false,
          isSuccess: true,
          refetch: vi.fn(),
        },
      ]);
      render(<MyPerformancesPage searchParams={pageParams('1')} />);
      fireEvent.click(screen.getByTestId('delete-take-take-delete-flow'));
      fireEvent.click(screen.getByTestId('confirm-delete-take-button'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(
        screen.getByTestId('deleting-badge-take-delete-flow'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('play-take-take-delete-flow')).toBeDisabled();
      expect(
        screen.getByTestId('download-take-take-delete-flow'),
      ).toBeDisabled();
      expect(screen.getByTestId('delete-take-take-delete-flow')).toBeDisabled();
      await act(async () => {
        vi.advanceTimersByTime(2500);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByText('Delete Flow')).not.toBeInTheDocument();
      expect(screen.getByText('暂无已保存的演奏')).toBeInTheDocument();
    });
    it('does not claim success when deletion remains DELETING and stops polling after unmount', async () => {
      vi.useFakeTimers();
      const deletingTake = {
        ...fixture121Takes[0],
        take_id: 'take-slow-delete',
        deletion_status: 'DELETING' as const,
        manifest: {
          ...fixture121Takes[0].manifest,
          score_title_snapshot: 'Slow Delete',
        },
      };
      const refetch = vi.fn(async () => undefined);
      mockQueryOverride = {
        data: {
          data: {
            items: [deletingTake],
            total: 1,
            limit: 20,
            offset: 0,
            has_more: false,
          },
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch,
      };
      const rendered = render(
        <MyPerformancesPage searchParams={pageParams('1')} />,
      );
      expect(screen.getByText('Slow Delete')).toBeInTheDocument();
      await act(async () => {
        vi.advanceTimersByTime(30000);
      });
      expect(
        screen.getByTestId('delete-still-processing-notice'),
      ).toBeInTheDocument();
      expect(screen.getByText('删除仍在后台处理中')).toBeInTheDocument();
      expect(screen.queryByText('已删除该演奏')).not.toBeInTheDocument();
      const callsBeforeUnmount = refetch.mock.calls.length;
      rendered.unmount();
      await act(async () => {
        vi.advanceTimersByTime(10000);
      });
      expect(refetch.mock.calls.length).toBe(callsBeforeUnmount);
    });
    it('stops playback when deleting the active AUDIO take and leaves other active takes playable', async () => {
      const audioTake = {
        ...fixture121Takes[0],
        take_id: 'take-audio-delete',
        deletion_status: 'ACTIVE' as const,
        manifest: {
          ...fixture121Takes[0].manifest,
          score_title_snapshot: 'Deleting Audio',
        },
      };
      const otherTake = {
        ...fixture121Takes[1],
        take_id: 'take-other-active',
        deletion_status: 'ACTIVE' as const,
        manifest: {
          ...fixture121Takes[1].manifest,
          score_title_snapshot: 'Other Active',
        },
      };
      mockQueryOverride = {
        data: {
          data: {
            items: [audioTake, otherTake],
            total: 2,
            limit: 20,
            offset: 0,
            has_more: false,
          },
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch: vi.fn(),
      };
      render(<MyPerformancesPage searchParams={pageParams('1')} />);
      fireEvent.click(screen.getByTestId('play-take-take-audio-delete'));
      expect(
        screen.getByTestId('performance-replay-player'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('delete-take-take-audio-delete'));
      fireEvent.click(screen.getByTestId('confirm-delete-take-button'));
      await waitFor(() => {
        expect(mockDeleteTakeMutation.mutateAsync).toHaveBeenCalledWith(
          'take-audio-delete',
        );
      });
      expect(
        screen.queryByTestId('performance-replay-player'),
      ).not.toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.getByTestId('play-take-take-audio-delete'),
        ).toBeDisabled();
      });
      fireEvent.click(screen.getByTestId('play-take-take-other-active'));
      expect(
        screen.getByTestId('performance-replay-player'),
      ).toBeInTheDocument();
    });
    it('stops playback when deleting the active VIDEO take', async () => {
      const videoTake = {
        ...fixture121Takes[0],
        take_id: 'take-video-delete',
        deletion_status: 'ACTIVE' as const,
        manifest: {
          ...fixture121Takes[0].manifest,
          score_title_snapshot: 'Deleting Video',
          capture: {
            ...fixture121Takes[0].manifest.capture,
            kind: 'VIDEO' as const,
            mime_type: 'video/webm',
          },
        },
      };
      mockQueryOverride = {
        data: {
          data: {
            items: [videoTake],
            total: 1,
            limit: 20,
            offset: 0,
            has_more: false,
          },
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        refetch: vi.fn(),
      };
      render(<MyPerformancesPage searchParams={pageParams('1')} />);
      fireEvent.click(screen.getByTestId('play-take-take-video-delete'));
      expect(screen.getByText('Kind: VIDEO_RECORDING')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('delete-take-take-video-delete'));
      fireEvent.click(screen.getByTestId('confirm-delete-take-button'));
      await waitFor(() => {
        expect(mockDeleteTakeMutation.mutateAsync).toHaveBeenCalledWith(
          'take-video-delete',
        );
      });
      expect(
        screen.queryByTestId('performance-replay-player'),
      ).not.toBeInTheDocument();
      await waitFor(() => {
        expect(
          screen.getByTestId('play-take-take-video-delete'),
        ).toBeDisabled();
      });
    });
    it('shows accepted toast when take deletion is confirmed', async () => {
      mockToast.mockClear();
      render(<MyPerformancesPage searchParams={pageParams('1')} />);
      const deleteBtn = screen.getByTestId('delete-take-take-1');
      fireEvent.click(deleteBtn);
      const confirmBtn = screen.getByTestId('confirm-delete-take-button');
      fireEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockDeleteTakeMutation.mutateAsync).toHaveBeenCalledWith(
          'take-1',
        );
        expect(mockToast).toHaveBeenCalledWith({
          title: '删除请求已接受',
          description: '删除请求已接受，正在后台清理并释放配额。',
        });
      });
    });
  });
});
