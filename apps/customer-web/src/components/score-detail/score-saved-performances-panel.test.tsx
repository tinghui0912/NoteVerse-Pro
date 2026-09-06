// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScoreSavedPerformancesPanel } from './score-saved-performances-panel';

const mocks = vi.hoisted(() => ({
  deletePracticeReplayArtifact: vi.fn(),
  listSavedPracticePerformances: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  practiceApi: {
    deletePracticeReplayArtifact: mocks.deletePracticeReplayArtifact,
    listSavedPracticePerformances: mocks.listSavedPracticePerformances,
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'zh',
  useTranslations: () => {
    const messages: Record<string, string> = {
      loading: '加载中',
      savedPerformances: '已保存演奏',
      savedPerformancesEmptyTitle: '还没有保存的演奏',
      savedPerformancesEmptyDesc: '在演奏报告中保存后，会在这里显示。',
      savedPerformancesLoadFailed: '暂时无法加载已保存演奏，请稍后重试。',
      savedPerformancesInputMicrophone: '麦克风',
      savedPerformancesInputMidi: 'MIDI',
      savedPerformancesFullPiece: '全曲',
      savedPerformancesSelectedRange: '分段',
      savedPerformancesSingleMeasure: '第 {measure} 小节',
      savedPerformancesMeasureRange: '第 {start}-{end} 小节',
      viewSavedPerformance: '查看',
      deleteSavedPerformance: '删除回放',
      deleteSavedPerformanceTitle: '删除回放？',
      deleteSavedPerformanceDesc: '删除后，这次演奏将从“已保存演奏”中移除。',
      savedPerformanceDeleted: '已删除回放',
      savedPerformanceDeletedDesc: '这次保存的演奏已从列表中移除。',
      savedPerformanceDeleteFailed: '删除失败',
      savedPerformanceDeleteFailedDesc: '暂时无法删除这次回放，请稍后重试。',
    };
    return (key: string, values?: Record<string, string | number>) => {
      let message = messages[key] ?? key;
      for (const [name, value] of Object.entries(values ?? {})) {
        message = message.replace(`{${name}}`, String(value));
      }
      return message;
    };
  },
}));

function renderPanel(scoreId = 'score-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ScoreSavedPerformancesPanel scoreId={scoreId} />
    </QueryClientProvider>
  );
}

describe('ScoreSavedPerformancesPanel', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders saved performances with a report link', async () => {
    mocks.listSavedPracticePerformances.mockResolvedValueOnce({
      success: true,
      data: [
        {
          session_id: 'session-1',
          revision_id: 'revision-1',
          artifact_id: 'artifact-1',
          kind: 'AUDIO_RECORDING',
          input_source: 'MICROPHONE',
          practice_scope: {
            start_expected_group_id: 'g2',
            end_expected_group_id: 'g4',
            start_measure_number: 2,
            end_measure_number: 4,
          },
          started_at: '2026-09-05T10:00:00',
          finished_at: '2026-09-05T10:00:21',
          completion_reason: 'STOPPED_BY_USER',
          replay_duration_ms: 21000,
          saved_at: '2026-09-05T10:01:00',
          evaluation_available: false,
        },
      ],
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText('第 2-4 小节')).toBeInTheDocument());
    expect(screen.getByText('麦克风')).toBeInTheDocument();
    expect(screen.getByText('21s')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看/ })).toHaveAttribute(
      'href',
      '/zh/score/score-1/practice/summary?sessionId=session-1'
    );
  });

  it('renders an empty state when there are no saved performances', async () => {
    mocks.listSavedPracticePerformances.mockResolvedValueOnce({
      success: true,
      data: [],
    });

    renderPanel();

    await waitFor(() => expect(screen.getByText('还没有保存的演奏')).toBeInTheDocument());
  });

  it('deletes saved replay artifacts from the saved performances list', async () => {
    mocks.listSavedPracticePerformances.mockResolvedValue({
      success: true,
      data: [
        {
          session_id: 'session-1',
          revision_id: 'revision-1',
          artifact_id: 'artifact-1',
          kind: 'AUDIO_RECORDING',
          input_source: 'MICROPHONE',
          practice_scope: null,
          started_at: '2026-09-05T10:00:00',
          finished_at: '2026-09-05T10:00:21',
          completion_reason: 'STOPPED_BY_USER',
          replay_duration_ms: 21000,
          saved_at: '2026-09-05T10:01:00',
          evaluation_available: false,
        },
      ],
    });
    mocks.deletePracticeReplayArtifact.mockResolvedValueOnce({ success: true, data: null });

    renderPanel();

    await waitFor(() => expect(screen.getByText('全曲')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /删除回放/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除回放' }));

    await waitFor(() =>
      expect(mocks.deletePracticeReplayArtifact).toHaveBeenCalledWith('session-1', 'artifact-1')
    );
  });
});
