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
    takeScopeBeats: '第 {start} - {end} 拍',
    audioPlaybackFailed: '本次录音不可回放',
  };

  const common: Record<string, string> = {
    play: '播放',
    delete: '删除',
    cancel: '取消',
    loading: '加载中...',
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
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
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

const mockTakesQuery = vi.hoisted(() => ({
  data: {
    data: {
      items: [] as Array<Record<string, unknown>>,
      total: 0,
    },
  },
  isLoading: false,
  isError: false,
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
}));

vi.mock('@/hooks/queries/use-performance-take-queries', () => ({
  usePerformanceTakes: () => mockTakesQuery,
  useDeletePerformanceTake: () => mockDeleteTakeMutation,
  usePerformanceTakePlayback: (takeId: string, enabled: boolean) => {
    if (!enabled) {
      return { data: null, isLoading: false, isError: false };
    }
    return mockPlaybackQuery;
  },
}));

const mockScoreDetail = vi.hoisted(() => ({
  data: {
    data: {
      title: '月光奏鸣曲',
    },
  },
  isLoading: false,
}));

vi.mock('@/hooks/queries/use-score-queries', () => ({
  useScoreDetail: (scoreId: string) => {
    if (scoreId === '101') {
      return mockScoreDetail;
    }
    return { data: null, isLoading: false };
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
  });

  it('renders empty state when no takes exist', () => {
    mockTakesQuery.data.data.items = [];
    mockTakesQuery.data.data.total = 0;

    render(<MyPerformancesPage />);

    expect(screen.getByText('我的演奏')).toBeInTheDocument();
    expect(screen.getByText('暂无已保存的演奏')).toBeInTheDocument();
  });

  it('renders list of saved takes with details', () => {
    mockTakesQuery.data.data.items = [
      {
        take_id: 'take-1',
        score_id: 101,
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 102400,
        duration_ms: 90000,
        scope_start_beat: 0,
        scope_terminal_beat: 0,
        tempo_selection: { mode: 'custom', customBpm: 92 },
        created_at: '2026-09-20T10:00:00Z',
      },
      {
        take_id: 'take-2',
        score_id: 202,
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 51200,
        duration_ms: 45000,
        scope_start_beat: 16,
        scope_terminal_beat: 32,
        tempo_selection: { mode: 'score' },
        created_at: '2026-09-20T11:00:00Z',
      },
    ];
    mockTakesQuery.data.data.total = 2;

    render(<MyPerformancesPage />);

    // Score 101 has title "月光奏鸣曲"
    expect(screen.getByText('月光奏鸣曲')).toBeInTheDocument();
    // Score 202 has no title mock -> fallback "乐谱 #202"
    expect(screen.getByText('乐谱 #202')).toBeInTheDocument();

    // Check duration
    expect(screen.getByText('1:30')).toBeInTheDocument();
    expect(screen.getByText('0:45')).toBeInTheDocument();

    // Scope
    expect(screen.getByText('全曲演奏')).toBeInTheDocument();
    expect(screen.getByText('选段演奏 (第 16 - 32 拍)')).toBeInTheDocument();

    // Tempo
    expect(screen.getByText('♩ = 92 BPM')).toBeInTheDocument();

    // Action buttons
    expect(screen.getByTestId('play-take-take-1')).toBeInTheDocument();
    expect(screen.getByTestId('download-take-take-1')).toBeInTheDocument();
    expect(screen.getByTestId('delete-take-take-1')).toBeInTheDocument();
  });

  it('triggers playback when play button is clicked', () => {
    mockTakesQuery.data.data.items = [
      {
        take_id: 'take-1',
        score_id: 101,
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 102400,
        duration_ms: 90000,
        scope_start_beat: 0,
        scope_terminal_beat: 0,
        created_at: '2026-09-20T10:00:00Z',
      },
    ];

    render(<MyPerformancesPage />);

    const playBtn = screen.getByTestId('play-take-take-1');
    fireEvent.click(playBtn);

    expect(screen.getByTestId('performance-replay-player')).toBeInTheDocument();
    expect(screen.getByText('Replaying: https://oss.example.com/play-1.webm')).toBeInTheDocument();
  });

  it('triggers download when download button is clicked', async () => {
    mockTakesQuery.data.data.items = [
      {
        take_id: 'take-1',
        score_id: 101,
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 102400,
        duration_ms: 90000,
        scope_start_beat: 0,
        scope_terminal_beat: 0,
        created_at: '2026-09-20T10:00:00Z',
      },
    ];

    render(<MyPerformancesPage />);

    const downloadBtn = screen.getByTestId('download-take-take-1');
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(mockApi.getPlaybackUrl).toHaveBeenCalledWith('take-1');
    });
  });

  it('opens confirmation dialog and deletes take', async () => {
    mockTakesQuery.data.data.items = [
      {
        take_id: 'take-1',
        score_id: 101,
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 102400,
        duration_ms: 90000,
        scope_start_beat: 0,
        scope_terminal_beat: 0,
        created_at: '2026-09-20T10:00:00Z',
      },
    ];

    render(<MyPerformancesPage />);

    const deleteBtn = screen.getByTestId('delete-take-take-1');
    fireEvent.click(deleteBtn);

    expect(screen.getByText('确定要删除这条演奏记录吗？')).toBeInTheDocument();

    const confirmBtn = screen.getByRole('button', { name: '删除' });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockDeleteTakeMutation.mutateAsync).toHaveBeenCalledWith('take-1');
    });
  });

  it('renders deleted score gracefully with no link and snapshot or fallback notice', () => {
    mockTakesQuery.data.data.items = [
      {
        take_id: 'take-deleted',
        score_id: null,
        score_title: '已删除的奏鸣曲',
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 102400,
        duration_ms: 60000,
        scope_start_beat: 0,
        scope_terminal_beat: 0,
        created_at: '2026-09-20T10:00:00Z',
      },
    ];
    mockTakesQuery.data.data.total = 1;

    render(<MyPerformancesPage />);

    // Score title snapshot is rendered
    expect(screen.getByText('已删除的奏鸣曲')).toBeInTheDocument();
    // Non-link element rendered
    expect(screen.getByTestId('take-deleted-score-take-deleted')).toBeInTheDocument();
    expect(screen.queryByTestId('take-score-link-take-deleted')).not.toBeInTheDocument();
  });

  it('renders load more button when more takes are available', () => {
    mockTakesQuery.data.data.items = [
      {
        take_id: 'take-1',
        score_id: 101,
        media_kind: 'AUDIO',
        media_mime_type: 'audio/webm',
        media_byte_size: 102400,
        duration_ms: 90000,
        scope_start_beat: 0,
        scope_terminal_beat: 0,
        created_at: '2026-09-20T10:00:00Z',
      },
    ];
    mockTakesQuery.data.data.total = 100; // total > items.length

    render(<MyPerformancesPage />);

    expect(screen.getByTestId('load-more-takes')).toBeInTheDocument();
  });
});
