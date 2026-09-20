// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  scoreId: 'score-123',
}));

const translationMocks = vi.hoisted(() => {
  const practice: Record<string, string> = {
    reviewTitle: '临时演奏报告',
    reviewExpiredTitle: '本次临时报告已失效',
    reviewExpiredDesc: '临时演奏报告仅在本次演奏结束后保留于当前页面会话中。刷新页面或重新打开后已失效。',
    backToPractice: '返回练习',
    backToScore: '返回乐谱',
    audioRecordingUnavailable: '本次录音不可用',
    audioRecordingUnavailableMicDenied: '未授予麦克风权限',
    audioRecordingUnavailableDesc: '由于未授予录音权限或设备不支持，本次演奏未录制音频。',
    performanceDuration: '演奏时长',
    performanceScope: '练习范围',
    performanceTempo: '演奏速度',
    performanceInput: '输入方式',
    inputSourceMic: '麦克风 (Acoustic)',
    inputSourceMidi: 'MIDI 键盘',
    scopeFull: '全曲演奏',
    scopeSection: '选段演奏',
    performanceOutcomes: '音符匹配结果',
    matchedGroupCount: '已匹配音符组',
    partialGroupCount: '部分匹配音符组',
    unobservedGroupCount: '未观察到音符组',
    totalGroupCount: '总目标音符组',
    retryPractice: '重弹一次',
    playback: '练习回放',
  };

  function translate(dict: Record<string, string>) {
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
    practice: translate(practice),
  };
});

vi.mock('next-intl', () => ({
  useLocale: () => 'zh',
  useTranslations: () => translationMocks.practice,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: navigationMocks.scoreId }),
  useRouter: () => ({
    push: navigationMocks.push,
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

vi.mock('@/i18n/routing', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
  useRouter: () => ({ push: navigationMocks.push }),
  usePathname: () => '/score/score-123/practice/review',
}));

vi.mock('@/hooks/practice/use-practice-ready-score-content', () => ({
  usePracticeReadyScoreContent: vi.fn(() => ({
    xmlContent: '<score-partwise></score-partwise>',
    isLoading: false,
    selectedRevisionId: 'rev-1',
  })),
}));

vi.mock('@/hooks/practice/use-practice-score-artifact', () => ({
  usePracticeScoreArtifact: vi.fn(() => ({
    artifact: {
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scoreEndBeat: 16,
    },
  })),
}));

vi.mock('@/components/score-preview/verovio-score-viewer', () => ({
  VerovioScoreViewer: ({ onRendered }: { onRendered?: (el: HTMLElement) => void }) => {
    return (
      <div
        data-testid="mock-verovio-viewer"
        ref={(el) => {
          if (el && onRendered) onRendered(el);
        }}
      >
        Mock Score Viewer
      </div>
    );
  },
}));

vi.mock('@/components/practice/performance-replay-player', () => ({
  PerformanceReplayPlayer: () => {
    return <div data-testid="mock-replay-player">Mock Replay Player</div>;
  },
}));

import PracticeReviewPage from './page';
import {
  performanceReviewDraftStore,
  type PerformanceReviewDraft,
} from '@/lib/practice/performance-review-draft';

describe('PracticeReviewPage', () => {
  beforeEach(() => {
    navigationMocks.push.mockClear();
    performanceReviewDraftStore.clearDraft();
  });

  it('renders expired empty state when draft is absent', () => {
    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
    expect(
      screen.getByText('临时演奏报告仅在本次演奏结束后保留于当前页面会话中。刷新页面或重新打开后已失效。')
    ).toBeDefined();

    const backButton = screen.getByRole('button', { name: /返回练习/i });
    fireEvent.click(backButton);
    expect(navigationMocks.push).toHaveBeenCalledWith('/score/score-123/practice');
  });

  it('renders expired empty state when draft scoreId does not match url', () => {
    performanceReviewDraftStore.setDraft({
      localSessionId: 'sess-1',
      scoreId: 'score-OTHER',
      scope: { startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 8 },
      tempoPlan: { selection: { mode: 'SCORE' }, segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }] },
      performanceSnapshot: {} as unknown as PerformanceReviewDraft['performanceSnapshot'],
      audio: { status: 'UNAVAILABLE', reason: 'NONE' },
      replayTiming: { scopeStartBeat: 0, scopeStartMs: 0, nominalDurationMs: 6000 },
      completedAt: new Date().toISOString(),
    });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
  });

  it('renders full review report with player when valid draft has audio READY', () => {
    const validDraft: PerformanceReviewDraft = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      scope: { startIndex: 0, endIndex: 3, startBeat: 0, terminalBeat: 16 },
      tempoPlan: {
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 },
        segments: [{ startBeat: 0, bpm: 100, source: 'CUSTOM' }],
      },
      performanceSnapshot: {
        localSessionId: 'sess-1',
        scoreId: 'score-123',
        revisionId: 'rev-1',
        artifactId: 'art-1',
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
        tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 },
        metronomeEnabled: false,
        lifecycleState: 'ENDED',
        completionReason: 'SCOPE_COMPLETED',
        version: { schemaVersion: 1, runtimeVersion: '1.0.0' },
        createdAtMs: 1000,
        updatedAtMs: 11000,
        performance: {
          state: 'ENDED',
          stateBeforePause: 'RUNNING',
          resolvedTempoPlan: {
            selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 },
            segments: [{ startBeat: 0, bpm: 100, source: 'CUSTOM' }],
          },
          scopeStartBeat: 0,
          scopeTerminalBeat: 16,
          activeElapsedMs: 9600,
          countInMs: 2400,
          countInBeats: 4,
          countInPulses: 4,
          observations: [],
          outcomes: [
            {
              expectedGroupId: 'g-1',
              performanceTimeMs: 0,
              result: 'MATCH',
              confidence: 0.9,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [{ strikeId: 's-1', pitch: 'C4', renderNoteIds: ['n-1'], result: 'MATCHED' }],
              unexpectedPitches: [],
              renderNoteIds: ['n-1'],
              measureNumbers: ['1'],
            },
            {
              expectedGroupId: 'g-2',
              performanceTimeMs: 600,
              result: 'PARTIAL',
              confidence: 0.7,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [{ strikeId: 's-2', pitch: 'D4', renderNoteIds: ['n-2'], result: 'UNCONFIRMED' }],
              unexpectedPitches: [],
              renderNoteIds: ['n-2'],
              measureNumbers: ['1'],
            },
          ],
        },
      },
      audio: {
        status: 'READY',
        blob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 9600,
      },
      replayTiming: {
        scopeStartBeat: 0,
        scopeStartMs: 0,
        nominalDurationMs: 9600,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    performanceReviewDraftStore.setDraft(validDraft);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('临时演奏报告')).toBeDefined();
    expect(screen.getByText('00:09')).toBeDefined(); // 9600ms = 9s
    expect(screen.getByText('100 BPM')).toBeDefined();
    expect(screen.getByText('麦克风 (Acoustic)')).toBeDefined();
    expect(screen.getByText('全曲演奏 (0 - 16 拍)')).toBeDefined();

    // Outcomes
    expect(screen.getByText('1 / 2')).toBeDefined(); // matched count
    expect(screen.getByText('1')).toBeDefined(); // partial count

    // Player should be rendered
    expect(screen.getByTestId('mock-replay-player')).toBeDefined();
    expect(screen.getByTestId('mock-verovio-viewer')).toBeDefined();

    // Clicking retry button clears draft and routes to practice
    const retryButton = screen.getByRole('button', { name: /重弹一次/i });
    fireEvent.click(retryButton);
    expect(performanceReviewDraftStore.getDraft()).toBeNull();
    expect(navigationMocks.push).toHaveBeenCalledWith('/score/score-123/practice');
  });

  it('renders notice when audio recording is UNAVAILABLE due to denied mic permission', () => {
    const validDraft: PerformanceReviewDraft = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      scope: { startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }],
      },
      performanceSnapshot: {
        localSessionId: 'sess-1',
        scoreId: 'score-123',
        revisionId: 'rev-1',
        artifactId: 'art-1',
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MIDI',
        tempoSelection: { mode: 'SCORE' },
        metronomeEnabled: false,
        lifecycleState: 'ENDED',
        completionReason: 'SCOPE_COMPLETED',
        version: { schemaVersion: 1, runtimeVersion: '1.0.0' },
        createdAtMs: 1000,
        updatedAtMs: 4000,
        performance: {
          state: 'ENDED',
          stateBeforePause: 'RUNNING',
          resolvedTempoPlan: {
            selection: { mode: 'SCORE' },
            segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }],
          },
          scopeStartBeat: 0,
          scopeTerminalBeat: 4,
          activeElapsedMs: 3000,
          countInMs: 0,
          countInBeats: 0,
          countInPulses: 0,
          observations: [],
          outcomes: [],
        },
      },
      audio: {
        status: 'UNAVAILABLE',
        reason: 'PERMISSION_DENIED',
      },
      replayTiming: {
        scopeStartBeat: 0,
        scopeStartMs: 0,
        nominalDurationMs: 3000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    performanceReviewDraftStore.setDraft(validDraft);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('本次录音不可用')).toBeDefined();
    expect(screen.getByText('未授予麦克风权限')).toBeDefined();
    expect(screen.queryByTestId('mock-replay-player')).toBeNull();
  });
});
