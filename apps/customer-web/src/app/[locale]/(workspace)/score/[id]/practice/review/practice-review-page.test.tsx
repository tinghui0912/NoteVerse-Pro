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
    mismatchGroupCount: '错音音符组',
    uncertainGroupCount: '不确定音符组',
    unobservedGroupCount: '未观察到音符组',
    totalGroupCount: '总目标音符组',
    scoreRevisionMismatchTitle: '乐谱版本不一致',
    scoreRevisionMismatchDesc: '当前乐谱版本与本次演奏生成的报告版本不一致，已停用谱面标注与回放同步，仅保留音频回放与数据统计。',
    audioPlaybackFailed: '本次录音不可回放',
    savePerformance: '保存演奏',
    performanceSaved: '已保存',
    savingPerformance: '正在保存...',
    retrySavePerformance: '重试保存',
    viewMyPerformances: '查看我的演奏',
    savePerformanceSuccessTitle: '演奏已保存',
    savePerformanceSuccessDesc: '可以稍后在已保存演奏中查看。',
    savePerformanceFailedTitle: '保存失败',
    savePerformanceFailedDesc: '暂时无法保存这次演奏，请稍后重试。',
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

const useScoreDetailMock = vi.fn((_scoreId: string, _enabled = true) => ({
  data: { data: { head_revision_id: 'rev-1' } },
  isLoading: false,
}));

vi.mock('@/hooks/queries/use-score-queries', () => ({
  useScoreDetail: (scoreId: string, enabled?: boolean) => useScoreDetailMock(scoreId, enabled),
}));

const saveMutationMock = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock('@/hooks/queries/use-performance-take-queries', () => ({
  useSavePerformanceTake: () => saveMutationMock,
}));

vi.mock('@/hooks/practice/use-practice-ready-score-content', () => ({
  usePracticeReadyScoreContent: vi.fn(() => ({
    data: {
      data: {
        content: '<score-partwise></score-partwise>',
      },
    },
    isLoading: false,
    selectedRevisionId: 'rev-1',
  })),
}));

let currentMockArtifact = {
  scoreId: 'score-123',
  revisionId: 'rev-1',
  artifactId: 'art-1',
  scoreEndBeat: 16,
};

vi.mock('@/hooks/practice/use-practice-score-artifact', () => ({
  usePracticeScoreArtifact: vi.fn(() => ({
    data: currentMockArtifact,
    isLoading: false,
  })),
}));

vi.mock('@/components/score-preview/verovio-score-viewer', () => ({
  VerovioScoreViewer: ({ onRendered }: { onRendered?: (adapter: unknown, el: HTMLElement) => void }) => {
    return (
      <div
        data-testid="mock-verovio-viewer"
        ref={(el) => {
          if (el && onRendered) onRendered(null, el);
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
import { PracticeSummaryAnnotationController } from '@/lib/practice/summary-annotation-controller';

describe('PracticeReviewPage', () => {
  beforeEach(() => {
    navigationMocks.push.mockClear();
    performanceReviewDraftStore.clearDraft();
    currentMockArtifact = {
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scoreEndBeat: 16,
    };
    vi.restoreAllMocks();
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
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 6000,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 6000, mediaStartMs: 0, mediaEndMs: 6000 }],
        nominalMediaDurationMs: 6000,
      },
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
      revisionId: 'rev-1',
      artifactId: 'art-1',
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
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 9600,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 9600, mediaStartMs: 0, mediaEndMs: 9600 }],
        nominalMediaDurationMs: 9600,
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

  it('correctly categorizes note-by-note strike colors and all 5 outcome counters', () => {
    const applySpy = vi.spyOn(PracticeSummaryAnnotationController.prototype, 'apply');

    const draftWithChordsAndOutcomes: PerformanceReviewDraft = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { startIndex: 0, endIndex: 4, startBeat: 0, terminalBeat: 20 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'MUSICXML' }],
      },
      performanceSnapshot: {
        localSessionId: 'sess-1',
        scoreId: 'score-123',
        revisionId: 'rev-1',
        artifactId: 'art-1',
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
        tempoSelection: { mode: 'SCORE' },
        metronomeEnabled: false,
        lifecycleState: 'ENDED',
        completionReason: 'SCOPE_COMPLETED',
        version: { schemaVersion: 1, runtimeVersion: '1.0.0' },
        createdAtMs: 1000,
        updatedAtMs: 12000,
        performance: {
          state: 'ENDED',
          stateBeforePause: 'RUNNING',
          resolvedTempoPlan: {
            selection: { mode: 'SCORE' },
            segments: [{ startBeat: 0, bpm: 80, source: 'MUSICXML' }],
          },
          scopeStartBeat: 0,
          scopeTerminalBeat: 20,
          activeElapsedMs: 10000,
          countInMs: 0,
          countInBeats: 0,
          countInPulses: 0,
          observations: [],
          outcomes: [
            // 1. MATCH group with 2 matched strikes in a chord
            {
              expectedGroupId: 'g-1',
              performanceTimeMs: 0,
              result: 'MATCH',
              confidence: 0.95,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                { strikeId: 's-c4', pitch: 'C4', renderNoteIds: ['note-c4'], result: 'MATCHED' },
                { strikeId: 's-e4', pitch: 'E4', renderNoteIds: ['note-e4'], result: 'MATCHED' },
              ],
              unexpectedPitches: [],
              renderNoteIds: ['note-c4', 'note-e4'],
              measureNumbers: ['1'],
            },
            // 2. PARTIAL group with 1 matched, 1 missing strike
            {
              expectedGroupId: 'g-2',
              performanceTimeMs: 1000,
              result: 'PARTIAL',
              confidence: 0.7,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                { strikeId: 's-g4', pitch: 'G4', renderNoteIds: ['note-g4'], result: 'MATCHED' },
                { strikeId: 's-b4', pitch: 'B4', renderNoteIds: ['note-b4'], result: 'MISSING' },
              ],
              unexpectedPitches: [],
              renderNoteIds: ['note-g4', 'note-b4'],
              measureNumbers: ['1'],
            },
            // 3. MISMATCH group where 1 note was actually matched
            {
              expectedGroupId: 'g-3',
              performanceTimeMs: 2000,
              result: 'MISMATCH',
              confidence: 0.3,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                { strikeId: 's-c5', pitch: 'C5', renderNoteIds: ['note-c5'], result: 'MATCHED' },
                { strikeId: 's-e5', pitch: 'E5', renderNoteIds: ['note-e5'], result: 'MISSING' },
              ],
              unexpectedPitches: ['D#5'],
              renderNoteIds: ['note-c5', 'note-e5'],
              measureNumbers: ['2'],
            },
            // 4. UNCERTAIN group with unconfirmed strike
            {
              expectedGroupId: 'g-4',
              performanceTimeMs: 3000,
              result: 'UNCERTAIN',
              confidence: 0.4,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                { strikeId: 's-f4', pitch: 'F4', renderNoteIds: ['note-f4'], result: 'UNCONFIRMED' },
              ],
              unexpectedPitches: [],
              renderNoteIds: ['note-f4'],
              measureNumbers: ['2'],
            },
            // 5. NOT_OBSERVED group
            {
              expectedGroupId: 'g-5',
              performanceTimeMs: 4000,
              result: 'NOT_OBSERVED',
              confidence: 0,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                { strikeId: 's-a4', pitch: 'A4', renderNoteIds: ['note-a4'], result: 'UNCONFIRMED' },
              ],
              unexpectedPitches: [],
              renderNoteIds: ['note-a4'],
              measureNumbers: ['3'],
            },
          ],
        },
      },
      audio: {
        status: 'READY',
        blob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 10000,
      },
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 10000,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 10000, mediaStartMs: 0, mediaEndMs: 10000 }],
        nominalMediaDurationMs: 10000,
      },
      replayTiming: {
        scopeStartBeat: 0,
        scopeStartMs: 0,
        nominalDurationMs: 10000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    performanceReviewDraftStore.setDraft(draftWithChordsAndOutcomes);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    // Check all 5 categories + total
    expect(screen.getByText('已匹配音符组')).toBeDefined();
    expect(screen.getByText('部分匹配音符组')).toBeDefined();
    expect(screen.getByText('错音音符组')).toBeDefined();
    expect(screen.getByText('不确定音符组')).toBeDefined();
    expect(screen.getByText('未观察到音符组')).toBeDefined();
    expect(screen.getByText('总目标音符组')).toBeDefined();

    expect(screen.getByText('1 / 5')).toBeDefined(); // matched
    expect(screen.getAllByText('1')).toHaveLength(4); // partial, mismatch, uncertain, unobserved each have 1
    expect(screen.getByText('5')).toBeDefined(); // total

    // Verify note-by-note strike annotation:
    // Green (matched): note-c4, note-e4, note-g4, note-c5
    // Red (missing): note-b4, note-e5
    // Neutral (unconfirmed/not_observed): note-f4, note-a4 should NOT be in either
    expect(applySpy).toHaveBeenCalled();
    const lastCall = applySpy.mock.calls[applySpy.mock.calls.length - 1];
    const annotations = lastCall[1];
    expect(annotations.confirmedCorrectNoteIds).toEqual(
      expect.arrayContaining(['note-c4', 'note-e4', 'note-g4', 'note-c5'])
    );
    expect(annotations.confirmedErrorNoteIds).toEqual(
      expect.arrayContaining(['note-b4', 'note-e5'])
    );
    expect(annotations.confirmedCorrectNoteIds).not.toContain('note-f4');
    expect(annotations.confirmedCorrectNoteIds).not.toContain('note-a4');
    expect(annotations.confirmedErrorNoteIds).not.toContain('note-f4');
    expect(annotations.confirmedErrorNoteIds).not.toContain('note-a4');
  });

  it('guards against score revision mismatch by disabling annotations and displaying notice', () => {
    const applySpy = vi.spyOn(PracticeSummaryAnnotationController.prototype, 'apply');

    // Artifact has revision 'rev-2', while draft has revision 'rev-1'
    currentMockArtifact = {
      scoreId: 'score-123',
      revisionId: 'rev-2',
      artifactId: 'art-1',
      scoreEndBeat: 16,
    };

    const validDraft: PerformanceReviewDraft = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'MUSICXML' }],
      },
      performanceSnapshot: {
        localSessionId: 'sess-1',
        scoreId: 'score-123',
        revisionId: 'rev-1',
        artifactId: 'art-1',
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
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
            segments: [{ startBeat: 0, bpm: 80, source: 'MUSICXML' }],
          },
          scopeStartBeat: 0,
          scopeTerminalBeat: 4,
          activeElapsedMs: 3000,
          countInMs: 0,
          countInBeats: 0,
          countInPulses: 0,
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
          ],
        },
      },
      audio: {
        status: 'READY',
        blob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 3000,
      },
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 3000,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
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

    // Warning banner rendered
    expect(screen.getByText('乐谱版本不一致')).toBeDefined();
    expect(
      screen.getByText(
        '当前乐谱版本与本次演奏生成的报告版本不一致，已停用谱面标注与回放同步，仅保留音频回放与数据统计。'
      )
    ).toBeDefined();

    // Score annotations are cleared
    expect(applySpy).toHaveBeenCalled();
    const lastCall = applySpy.mock.calls[applySpy.mock.calls.length - 1];
    expect(lastCall[1].confirmedCorrectNoteIds).toEqual([]);
    expect(lastCall[1].confirmedErrorNoteIds).toEqual([]);

    // Player and factual stats remain rendered
    expect(screen.getByTestId('mock-replay-player')).toBeDefined();
    expect(screen.getByText('演奏时长')).toBeDefined();
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
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 3000,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
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

    // When audio is UNAVAILABLE, Save Performance button is disabled
    const saveBtn = screen.getByRole('button', { name: '保存演奏' });
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('disables score queries when draft is absent', () => {
    performanceReviewDraftStore.clearDraft();
    useScoreDetailMock.mockClear();

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(useScoreDetailMock).toHaveBeenCalledWith('score-123', false);
    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
  });

  it('handles save performance flow with success state', async () => {
    const validDraft: PerformanceReviewDraft = {
      localSessionId: 'sess-save',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }],
      },
      performanceSnapshot: {
        localSessionId: 'sess-save',
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
        status: 'READY',
        blob: new Blob(['audio'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 3000,
      },
      recordingTimebase: {
        recordingStartPerfTimeMs: 0,
        recordingEndPerfTimeMs: 3000,
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
      },
      replayTiming: {
        scopeStartBeat: 0,
        scopeStartMs: 0,
        nominalDurationMs: 3000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    performanceReviewDraftStore.setDraft(validDraft);
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-abc' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    const saveBtn = screen.getByRole('button', { name: '保存演奏' });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(saveBtn);

    expect(saveMutationMock.mutateAsync).toHaveBeenCalled();
    const saveCall = saveMutationMock.mutateAsync.mock.calls[0][0];
    expect(saveCall.scoreId).toBe('score-123');
    expect(saveCall.revisionId).toBe('rev-1');
    expect(saveCall.scopeType).toBe('FULL');
    expect(saveCall.artifactId).toBe('art-1');
    expect(saveCall.audioBlob).toBeDefined();

    // After resolution, shows "已保存" and "查看我的演奏"
    await screen.findByText('已保存');
    expect(screen.getAllByText('查看我的演奏').length).toBeGreaterThanOrEqual(1);
  });
});
