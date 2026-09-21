// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MyPerformancesPage from './page';

const translationMocks = vi.hoisted(() => {
  const practice: Record<string, string> = {
    myPerformances: '我的演奏',
    noPerformancesTitle: '暂无已保存的演奏',
    noPerformancesDesc: '在连贯演奏结束后，点击“保存演奏”，你的录音就会保存在这里。',
    deletePerformanceTake: '删除演奏',
    deletePerformanceTakeConfirmTitle: '确定要删除这条演奏记录吗？',
    deletePerformanceTakeConfirmDesc: '删除后，该录音将从云端永久移除，无法恢复。',
    downloadRecording: '下载录音',
    performanceTakeDeleted: '已删除该演奏',
    performanceDuration: '演奏时长',
    performanceScope: '练习范围',
    performanceTempo: '演奏速度',
    performanceInput: '输入方式',
    inputSourceMic: '麦克风 (Acoustic)',
    scopeFull: '全曲演奏',
    scopeSection: '选段演奏',
    scoreFallback: '乐谱 #{id}',
    deletedScoreNotice: '原乐谱已删除',
    loadMore: '加载更多',
    noMorePerformances: '已加载全部演奏',
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
    delete: '删除',
    cancel: '取消',
    loading: '加载中...',
    tryAgain: '重试',
    loadFailedDescription: '暂时无法加载内容，请稍后重试。',
  };

  function createTranslator(dict: Record<string, string>) {
    const t = (key: string, values?: Record<string, string | number>) => {
      const template = dict[key] ?? key;
      return Object.entries(values ?? {}).reduce(
        (message, [name, val]) => message.replace(`{${name}}`, String(val)),
        template
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
  Link: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/my-performances',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock('@/components/practice/performance-replay-player', () => ({
  PerformanceReplayPlayer: ({ replay }: { replay: { url?: string } }) => (
    <div data-testid="performance-replay-player">
      <span>Replaying: {replay.url}</span>
    </div>
  ),
}));

const mockTakesInfiniteQuery = vi.hoisted(() => ({
  data: {
    pages: [
      {
        data: {
          items: [] as Array<Record<string, unknown>>,
          total: 0,
          limit: 50,
          offset: 0,
          has_more: false,
        },
      },
    ],
  },
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
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
      duration_ms: 90000,
      expires_in: 3600,
    },
  },
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}));

vi.mock('@/hooks/queries/use-performance-take-queries', () => ({
  useInfinitePerformanceTakes: () => mockTakesInfiniteQuery,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteTakeMutation.isPending = false;
    mockPlaybackQuery.isError = false;
    mockTakesInfiniteQuery.isLoading = false;
    mockTakesInfiniteQuery.isError = false;
    mockTakesInfiniteQuery.hasNextPage = false;
    mockTakesInfiniteQuery.isFetchingNextPage = false;
  });

  it('renders empty state when no takes exist', () => {
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            has_more: false,
          },
        },
      ],
    };

    render(<MyPerformancesPage />);

    expect(screen.getByText('我的演奏')).toBeInTheDocument();
    expect(screen.getByText('暂无已保存的演奏')).toBeInTheDocument();
  });

  it('renders list of saved takes with external UUID, scope, and tempo details', () => {
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: [
              {
                take_id: 'take-1',
                score_id: '550e8400-e29b-41d4-a716-446655440001',
                score_title: '月光奏鸣曲',
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 102400,
                duration_ms: 90000,
                scope_type: 'FULL',
                scope_start_beat: 0,
                scope_terminal_beat: 0,
                tempo_selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 92 },
                created_at: '2026-09-20T10:00:00Z',
              },
              {
                take_id: 'take-2',
                score_id: '550e8400-e29b-41d4-a716-446655440002',
                score_title: null,
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 51200,
                duration_ms: 45000,
                scope_type: 'RANGE',
                scope_start_beat: 16,
                scope_terminal_beat: 32,
                tempo_selection: { mode: 'SCORE' },
                resolved_tempo_plan: {
                  segments: [{ startBeat: 0, bpm: 120 }],
                },
                created_at: '2026-09-20T11:00:00Z',
              },
            ],
            total: 2,
            limit: 50,
            offset: 0,
            has_more: false,
          },
        },
      ],
    };

    render(<MyPerformancesPage />);

    // Score 1 has title snapshot "月光奏鸣曲" and Link to /score/UUID
    expect(screen.getByText('月光奏鸣曲')).toBeInTheDocument();
    const link1 = screen.getByTestId('take-score-link-take-1');
    expect(link1).toHaveAttribute('href', '/score/550e8400-e29b-41d4-a716-446655440001');

    // Score 2 has no title snapshot -> fallback "乐谱 #550e8400-e29b-41d4-a716-446655440002"
    expect(screen.getByText('乐谱 #550e8400-e29b-41d4-a716-446655440002')).toBeInTheDocument();
    const link2 = screen.getByTestId('take-score-link-take-2');
    expect(link2).toHaveAttribute('href', '/score/550e8400-e29b-41d4-a716-446655440002');

    // Duration
    expect(screen.getByText('1:30')).toBeInTheDocument();
    expect(screen.getByText('0:45')).toBeInTheDocument();

    // Scope (explicit FULL and RANGE)
    expect(screen.getByText('全曲演奏')).toBeInTheDocument();
    expect(screen.getByText('选段演奏 (第 16 - 32 拍)')).toBeInTheDocument();

    // Tempo
    expect(screen.getByText('♩ = 92 BPM')).toBeInTheDocument();
    expect(screen.getByText('原谱速度 (♩ = 120)')).toBeInTheDocument();

    // Action buttons
    expect(screen.getByTestId('play-take-take-1')).toBeInTheDocument();
    expect(screen.getByTestId('download-take-take-1')).toBeInTheDocument();
    expect(screen.getByTestId('delete-take-take-1')).toBeInTheDocument();
  });

  it('renders variable tempo when score has multiple tempo segments', () => {
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: [
              {
                take_id: 'take-var-tempo',
                score_id: '550e8400-e29b-41d4-a716-446655440003',
                score_title: '土耳其进行曲',
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 102400,
                duration_ms: 60000,
                scope_type: 'FULL',
                scope_start_beat: 0,
                scope_terminal_beat: 0,
                tempo_selection: { mode: 'SCORE' },
                resolved_tempo_plan: {
                  segments: [
                    { startBeat: 0, bpm: 120 },
                    { startBeat: 32, bpm: 140 },
                  ],
                },
                created_at: '2026-09-20T10:00:00Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false,
          },
        },
      ],
    };

    render(<MyPerformancesPage />);

    expect(screen.getByText('原谱速度 (变化速度)')).toBeInTheDocument();
  });

  it('renders deleted score gracefully with no link and snapshot title or fallback notice', () => {
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: [
              {
                take_id: 'take-deleted-1',
                score_id: null,
                score_title: '已删除的奏鸣曲',
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 102400,
                duration_ms: 60000,
                scope_type: 'FULL',
                scope_start_beat: 0,
                scope_terminal_beat: 0,
                created_at: '2026-09-20T10:00:00Z',
              },
              {
                take_id: 'take-deleted-2',
                score_id: null,
                score_title: null,
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 102400,
                duration_ms: 60000,
                scope_type: 'FULL',
                scope_start_beat: 0,
                scope_terminal_beat: 0,
                created_at: '2026-09-20T10:00:00Z',
              },
            ],
            total: 2,
            limit: 50,
            offset: 0,
            has_more: false,
          },
        },
      ],
    };

    render(<MyPerformancesPage />);

    // Snapshot title rendered without link
    expect(screen.getByText('已删除的奏鸣曲')).toBeInTheDocument();
    expect(screen.getByTestId('take-deleted-score-take-deleted-1')).toBeInTheDocument();
    expect(screen.queryByTestId('take-score-link-take-deleted-1')).not.toBeInTheDocument();

    // Fallback notice rendered when title is also null
    expect(screen.getByText('原乐谱已删除')).toBeInTheDocument();
    expect(screen.getByTestId('take-deleted-score-take-deleted-2')).toBeInTheDocument();
    expect(screen.queryByTestId('take-score-link-take-deleted-2')).not.toBeInTheDocument();
  });

  it('triggers playback when play button is clicked and allows retry on failure', () => {
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: [
              {
                take_id: 'take-1',
                score_id: 'score-1',
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 102400,
                duration_ms: 90000,
                scope_type: 'FULL',
                scope_start_beat: 0,
                scope_terminal_beat: 0,
                created_at: '2026-09-20T10:00:00Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false,
          },
        },
      ],
    };

    const { rerender } = render(<MyPerformancesPage />);

    const playBtn = screen.getByTestId('play-take-take-1');
    fireEvent.click(playBtn);

    expect(screen.getByTestId('performance-replay-player')).toBeInTheDocument();
    expect(screen.getByText('Replaying: https://oss.example.com/play-1.webm')).toBeInTheDocument();

    // Test playback error
    mockPlaybackQuery.isError = true;
    rerender(<MyPerformancesPage />);

    expect(screen.getByText('本次录音不可回放')).toBeInTheDocument();
    const retryBtn = screen.getByTestId('retry-playback-take-1');
    fireEvent.click(retryBtn);
    expect(mockPlaybackQuery.refetch).toHaveBeenCalled();
  });

  it('triggers download with download_url and handles download failure with retry', async () => {
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: [
              {
                take_id: 'take-1',
                score_id: 'score-1',
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 102400,
                duration_ms: 90000,
                scope_type: 'FULL',
                scope_start_beat: 0,
                scope_terminal_beat: 0,
                created_at: '2026-09-20T10:00:00Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false,
          },
        },
      ],
    };

    render(<MyPerformancesPage />);

    const downloadBtn = screen.getByTestId('download-take-take-1');
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(mockApi.getPlaybackUrl).toHaveBeenCalledWith('take-1');
    });

    // Test failure case
    mockApi.getPlaybackUrl.mockRejectedValueOnce(new Error('Network error'));
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(screen.getByTestId('download-error-take-1')).toBeInTheDocument();
      expect(screen.getByText('下载录音失败，请重试')).toBeInTheDocument();
    });

    // Test retry
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

  it('opens confirmation dialog, keeps dialog open on delete failure, and displays retryable error', async () => {
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: [
              {
                take_id: 'take-1',
                score_id: 'score-1',
                media_kind: 'AUDIO',
                media_mime_type: 'audio/webm',
                media_byte_size: 102400,
                duration_ms: 90000,
                scope_type: 'FULL',
                scope_start_beat: 0,
                scope_terminal_beat: 0,
                created_at: '2026-09-20T10:00:00Z',
              },
            ],
            total: 1,
            limit: 50,
            offset: 0,
            has_more: false,
          },
        },
      ],
    };

    render(<MyPerformancesPage />);

    const deleteBtn = screen.getByTestId('delete-take-take-1');
    fireEvent.click(deleteBtn);

    expect(screen.getByText('确定要删除这条演奏记录吗？')).toBeInTheDocument();

    // 1. Simulate failure
    mockDeleteTakeMutation.mutateAsync.mockRejectedValueOnce(new Error('Delete failed'));
    const confirmBtn = screen.getByTestId('confirm-delete-take-button');
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(screen.getByTestId('delete-take-error')).toBeInTheDocument();
      expect(screen.getByText('删除演奏失败，请重试')).toBeInTheDocument();
    });

    // Dialog must remain open
    expect(screen.getByText('确定要删除这条演奏记录吗？')).toBeInTheDocument();

    // 2. Retry with success
    mockDeleteTakeMutation.mutateAsync.mockResolvedValueOnce({ data: { deleted: true } });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteTakeMutation.mutateAsync).toHaveBeenCalledWith('take-1');
    });

    // Upon success, dialog closes
    await waitFor(() => {
      expect(screen.queryByText('确定要删除这条演奏记录吗？')).not.toBeInTheDocument();
    });
  });

  it('supports 121+ items pagination with fixed limit 50, deduplication by take_id, and loads more', async () => {
    // Generate 50 items for page 1
    const page1Items = Array.from({ length: 50 }, (_, i) => ({
      take_id: `take-${i + 1}`,
      score_id: `score-${i + 1}`,
      score_title: `Score ${i + 1}`,
      media_kind: 'AUDIO',
      media_mime_type: 'audio/webm',
      media_byte_size: 10000,
      duration_ms: 30000,
      scope_type: 'FULL',
      scope_start_beat: 0,
      scope_terminal_beat: 0,
      created_at: '2026-09-20T10:00:00Z',
    }));

    // Page 2: items 51-100 + duplicate of take-50 to test deduplication
    const page2Items = [
      page1Items[49], // duplicate take-50
      ...Array.from({ length: 50 }, (_, i) => ({
        take_id: `take-${i + 51}`,
        score_id: `score-${i + 51}`,
        score_title: `Score ${i + 51}`,
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 10000,
        duration_ms: 30000,
        scope_type: 'FULL',
        scope_start_beat: 0,
        scope_terminal_beat: 0,
        created_at: '2026-09-20T09:00:00Z',
      })),
    ];

    // Page 3: items 101-121 (21 items, total 121)
    const page3Items = Array.from({ length: 21 }, (_, i) => ({
      take_id: `take-${i + 101}`,
      score_id: `score-${i + 101}`,
      score_title: `Score ${i + 101}`,
      media_kind: 'AUDIO',
      media_mime_type: 'audio/webm',
      media_byte_size: 10000,
      duration_ms: 30000,
      scope_type: 'FULL',
      scope_start_beat: 0,
      scope_terminal_beat: 0,
      created_at: '2026-09-20T08:00:00Z',
    }));

    // Start with page 1 loaded
    mockTakesInfiniteQuery.data = {
      pages: [
        {
          data: {
            items: page1Items,
            total: 121,
            limit: 50,
            offset: 0,
            has_more: true,
          },
        },
      ],
    };
    mockTakesInfiniteQuery.hasNextPage = true;

    const { rerender } = render(<MyPerformancesPage />);

    // Verify card 1 and card 50 exist
    expect(screen.getByTestId('take-score-link-take-1')).toBeInTheDocument();
    expect(screen.getByTestId('take-score-link-take-50')).toBeInTheDocument();
    expect(screen.queryByTestId('take-score-link-take-51')).not.toBeInTheDocument();

    // Click load more
    const loadMoreBtn = screen.getByTestId('load-more-takes');
    expect(loadMoreBtn).toBeInTheDocument();
    fireEvent.click(loadMoreBtn);
    expect(mockTakesInfiniteQuery.fetchNextPage).toHaveBeenCalled();

    // Simulate page 2 loaded
    mockTakesInfiniteQuery.data = {
      pages: [
        mockTakesInfiniteQuery.data.pages[0],
        {
          data: {
            items: page2Items,
            total: 121,
            limit: 50,
            offset: 50,
            has_more: true,
          },
        },
      ],
    };
    rerender(<MyPerformancesPage />);

    // Verify card 51 and card 100 are now present, and take-50 wasn't duplicated
    expect(screen.getByTestId('take-score-link-take-51')).toBeInTheDocument();
    expect(screen.getByTestId('take-score-link-take-100')).toBeInTheDocument();
    expect(screen.getAllByTestId('take-score-link-take-50')).toHaveLength(1);

    // Simulate page 3 loaded (all 121 items loaded, hasNextPage = false)
    mockTakesInfiniteQuery.data = {
      pages: [
        ...mockTakesInfiniteQuery.data.pages,
        {
          data: {
            items: page3Items,
            total: 121,
            limit: 50,
            offset: 100,
            has_more: false,
          },
        },
      ],
    };
    mockTakesInfiniteQuery.hasNextPage = false;
    rerender(<MyPerformancesPage />);

    // Verify card 101 and card 121 exist
    expect(screen.getByTestId('take-score-link-take-101')).toBeInTheDocument();
    expect(screen.getByTestId('take-score-link-take-121')).toBeInTheDocument();

    // "All performances loaded" message should appear
    expect(screen.getByText('已加载全部演奏')).toBeInTheDocument();
    expect(screen.queryByTestId('load-more-takes')).not.toBeInTheDocument();
  });
});
