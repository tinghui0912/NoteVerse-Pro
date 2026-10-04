// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    performanceDetails: '演奏详情',
    targetStrikes: '目标音',
    confirmedCorrectStrikes: '正确击键',
    missingStrikes: '漏弹',
    notReachedStrikes: '未完成',
    notReachedStrikesDesc: '这些目标音位于本次已完成演奏范围之外，因此没有计为漏弹。',
    extraPitchCount: '额外演奏',
    matchedGroupCount: '已匹配音符组',
    partialGroupCount: '部分匹配音符组',
    mismatchGroupCount: '错音音符组',
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
    exportOriginalVideo: '导出原始视频',
    exportScoreVideo: '导出乐谱＋视频',
    exportScoreVideoProgressTitle: '正在合成乐谱＋演奏视频',
    exportScoreVideoProgressDesc: '已处理 {progress}%。请保持页面打开。',
    cancelExportScoreVideo: '取消合成',
    exportScoreVideoFailedTitle: '合成导出失败',
    exportScoreVideoFailedDesc: '暂时无法合成这次乐谱＋演奏视频。原始视频和保存演奏仍可继续使用。',
    exportScoreVideoUnavailableVideo: '需要一段可播放的本地视频才能合成导出。',
    exportScoreVideoUnavailableScore: '乐谱尚未准备好，暂不能可靠合成。',
    exportScoreVideoUnavailableScoreMismatch: '当前乐谱版本与录像不一致，暂不能可靠合成。',
    exportScoreVideoUnavailableSync: '缺少可靠的录像与乐谱时间映射，暂不能合成。',
    exportScoreVideoUnsupportedBrowser: '当前浏览器不支持本地视频合成导出。',
    savePerformanceMediaTooLarge: '本次媒体超过 100 MiB，暂不能保存到云端。你可以先导出原始视频。',
    savePerformanceVideoFormatUnsupported: '当前服务端暂只支持保存 WebM 视频。你仍可以导出原始视频或乐谱＋视频文件。',
    retryPractice: '重弹一次',
    playback: '练习回放',
    makeShareVideoTitle: '制作分享视频',
    makeShareVideoDesc: '将动态乐谱加入演奏画面，制作适合分享的视频。',
    makeShareVideoAction: '制作分享视频',
    collapseShareVideoStudio: '收起制作工具',
    sharePerformanceVideoTitle: '分享演奏视频',
    sharePerformanceVideoDesc: '将动态乐谱与原始演奏合成为分享视频。',
    shareVideoOrientationStep: '1. 视频比例',
    shareVideoOrientationDesc: '选择发布视频的画布方向。',
    shareLandscapeTitle: '横版 16:9',
    shareLandscapeDesc: '适合横向演奏视频。',
    sharePortraitTitle: '竖版 9:16',
    sharePortraitDesc: '适合手机竖屏分享。',
    sharePresentationStep: '2. 乐谱呈现方式',
    sharePresentationDesc: '选择乐谱与演奏画面的组合方式。',
    shareSplitTitle: '分屏',
    shareSplitDesc: '完整乐谱与演奏对照。',
    shareFloatingTitle: '悬浮乐谱',
    shareFloatingDesc: '演奏为主，动态乐谱叠加。',
    shareDevPreview: '开发预览',
    sharePositionStep: '3. 乐谱位置',
    sharePositionDesc: '悬浮乐谱会遮挡部分演奏画面。',
    shareAdjustPositionSize: '调整位置与大小',
    shareTop: '顶部',
    shareTopDesc: '靠近画面上方。',
    shareBottom: '底部',
    shareBottomDesc: '靠近画面下方。',
    shareScoreSize: '乐谱大小',
    shareSmall: '小',
    shareMedium: '中',
    shareLarge: '大',
    sharePreviewTitle: '实时合成预览',
    sharePreviewDesc: '与原始演奏回放同步。',
    sharePreviewTime: '预览时间：{time}',
    shareExportTitle: '导出视频',
    shareExportAction: '生成并下载分享视频',
    shareTemplateSummary: '{orientation} · {presentation} · {position} · 原始音轨',
    shareTemplateSummaryWithoutPosition: '{orientation} · {presentation} · 原始音轨',
    leaveReviewTitle: '离开临时演奏报告？',
    leaveReviewDesc: '这份临时演奏报告离开后可能无法再次访问。分享视频下载不等于保存原始演奏。',
    leaveReviewUnsavedMediaDesc: '原始录音或录像尚未保存为正式演奏。离开或重新练习后，这份临时媒体可能无法再次访问；分享视频下载不等于保存原始演奏。',
    leaveReviewWhileExportingDesc: '分享视频正在生成。确认离开会取消当前合成任务；分享视频下载不等于保存原始演奏。',
    leaveReviewWhileExportingAndUnsavedDesc: '分享视频正在生成，确认离开会取消当前合成任务；同时，原始录音或录像尚未保存为正式演奏，离开后这份临时媒体可能无法再次访问。',
    leaveReviewContinue: '继续查看',
    leaveReviewConfirm: '确认离开',
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

const createMockArtifact = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  scoreId: 'score-123',
  revisionId: 'rev-1',
  artifactId: 'art-1',
  scoreEndBeat: 16,
  playableEvents: [],
  scoreTempoSegments: [{ startBeat: 0, bpm: 100 }],
  meterSegments: [{
    startBeat: 0,
    numerator: 4,
    denominator: 4,
    measureDurationBeats: 4,
    countInPulses: 0,
  }],
  firstPlayableBeat: 0,
  expectedPracticeGroups: Array.from({ length: 5 }, (_, index) => ({
    groupId: `g-${index + 1}`,
    onsetBeat: index * 4,
    eventIds: [],
    expectedNotes: [],
    strikeTargets: [],
    renderNoteIds: [`n-${index + 1}`],
    pitches: [],
    measureNumbers: ['1'],
    staffIds: [],
    voiceIds: [],
    canonicalEndBeat: (index + 1) * 4,
  })),
  practiceAttackSteps: Array.from({ length: 5 }, (_, index) => ({
    stepId: `step-${index + 1}`,
    onsetBeat: index * 4,
    eventIds: [],
    attackTargets: [],
    continuation: [],
    renderNoteIds: [`n-${index + 1}`],
    measureNumbers: ['1'],
    staffIds: [],
    voiceIds: [],
  })),
  ...overrides,
});

let currentMockArtifact = createMockArtifact();

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

const shareVideoMocks = vi.hoisted(() => ({
  exportShareVideo: vi.fn(),
  getShareVideoExportReadiness: vi.fn(),
}));

vi.mock('@/lib/practice/share-video-export', () => ({
  exportShareVideo: shareVideoMocks.exportShareVideo,
  getShareVideoExportReadiness: shareVideoMocks.getShareVideoExportReadiness,
}));

import PracticeReviewPage from './page';
import {
  completedPerformanceStore,
  type CompletedContinuousEvaluation,
  type CompletedPerformance,
} from '@/lib/practice/completed-performance';
import { PerformanceAnnotationController } from '@/lib/practice/performance-annotation-controller';

type TestOutcome = {
  expectedGroupId: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI';
  expectedStrikeOutcomes: {
    strikeId: string;
    pitch: string;
    renderNoteIds: string[];
    result: 'MATCHED' | 'MISSING' | 'NOT_REACHED';
  }[];
  unexpectedPitches: string[];
  timingOffsetMs?: number;
  renderNoteIds?: string[];
  measureNumbers?: string[];
};

function completeEvaluation(
  outcomes: TestOutcome[] = []
): CompletedContinuousEvaluation {
  return {
    status: 'COMPLETE',
    strikes: outcomes.flatMap((outcome) =>
      outcome.expectedStrikeOutcomes.map((strike) => {
        const base = {
          strikeId: strike.strikeId,
          expectedGroupId: outcome.expectedGroupId,
          pitch: strike.pitch,
          performanceTimeMs: outcome.performanceTimeMs,
          renderNoteIds: strike.renderNoteIds,
        };
        if (strike.result === 'MATCHED') {
          return {
            ...base,
            result: 'MATCHED' as const,
            matchedObservationId: `${strike.strikeId}:matched`,
            confidence: outcome.confidence,
            source: outcome.source,
            timingOffsetMs: outcome.timingOffsetMs ?? 0,
          };
        }
        return {
          ...base,
          result: strike.result,
        };
      })
    ),
    extras: outcomes.flatMap((outcome) =>
      outcome.unexpectedPitches.map((pitch, index) => ({
        observationId: `${outcome.expectedGroupId}:${index}:${pitch}`,
        pitch,
        performanceTimeMs: outcome.performanceTimeMs,
        confidence: outcome.confidence,
        source: outcome.source,
      }))
    ),
  };
}

describe('PracticeReviewPage', () => {
  beforeEach(() => {
    navigationMocks.push.mockClear();
    completedPerformanceStore.clearPerformance();
    currentMockArtifact = createMockArtifact();
    vi.restoreAllMocks();
    saveMutationMock.mutateAsync.mockReset();
    shareVideoMocks.exportShareVideo.mockReset();
    shareVideoMocks.exportShareVideo.mockResolvedValue({
      blob: new Blob(['share-video'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 3000,
    });
    shareVideoMocks.getShareVideoExportReadiness.mockImplementation(
      ({
        draft,
        session,
        isScoreIdentityConfirmed,
        xmlContent,
        scoreContainer,
      }: {
        draft: CompletedPerformance | null;
        session?: { video?: { status?: string } } | null;
        isScoreIdentityConfirmed: boolean;
        xmlContent: string | null;
        scoreContainer: HTMLElement | null;
      }) => {
        if (draft?.media.status !== 'READY' && session?.video?.status !== 'READY') {
          return { ok: false, reason: 'video_not_ready' };
        }
        if (!isScoreIdentityConfirmed) return { ok: false, reason: 'score_identity_mismatch' };
        if (!xmlContent || !scoreContainer) return { ok: false, reason: 'score_not_ready' };
        return { ok: true, mimeType: 'video/webm' };
      }
    );
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
    completedPerformanceStore.setPerformance({
      localSessionId: 'sess-1',
      scoreId: 'score-OTHER',
      scope: { kind: 'FULL', startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 8 },
      tempoPlan: { selection: { mode: 'SCORE' }, segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }] },
      inputSource: 'MICROPHONE',
      activeElapsedMs: 0,
      evaluation: completeEvaluation(),
      revisionId: 'rev-1',
      artifactId: 'art-1',
      media: { status: 'UNAVAILABLE', reason: 'NONE' },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 6000, mediaStartMs: 0, mediaEndMs: 6000 }],
        nominalMediaDurationMs: 6000,
      },
      completedAt: new Date().toISOString(),
    });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
  });

  it('renders full review report with player when valid draft has audio READY', () => {
    const validDraft: CompletedPerformance = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { kind: 'FULL', startIndex: 0, endIndex: 3, startBeat: 0, terminalBeat: 16 },
      tempoPlan: {
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 },
        segments: [{ startBeat: 0, bpm: 100, source: 'CUSTOM' }],
      },
      inputSource: 'MICROPHONE',
      activeElapsedMs: 9600,
      evaluation: completeEvaluation([
            {
              expectedGroupId: 'g-1',
              performanceTimeMs: 0,
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
              confidence: 0.7,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [{ strikeId: 's-2', pitch: 'D4', renderNoteIds: ['n-2'], result: 'NOT_REACHED' }],
              unexpectedPitches: [],
              renderNoteIds: ['n-2'],
              measureNumbers: ['1'],
            },
          ]),
      media: {
        status: 'READY',
        kind: 'AUDIO',
        blob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 9600,
      },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 9600, mediaStartMs: 0, mediaEndMs: 9600 }],
        nominalMediaDurationMs: 9600,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    completedPerformanceStore.setPerformance(validDraft);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('临时演奏报告')).toBeDefined();
    expect(screen.getByText('00:09')).toBeDefined(); // 9600ms = 9s
    expect(screen.getByText('100 BPM')).toBeDefined();
    expect(screen.getByText('麦克风 (Acoustic)')).toBeDefined();
    expect(screen.getByText('全曲演奏 (0 - 16 拍)')).toBeDefined();

    // Strike-level summary
    expect(screen.getByText('目标音')).toBeDefined();
    expect(screen.getByText('正确击键')).toBeDefined();
    expect(screen.getByText('漏弹')).toBeDefined();
    expect(screen.getByText('额外演奏')).toBeDefined();

    // Player should be rendered
    expect(screen.getByTestId('mock-replay-player')).toBeDefined();
    expect(screen.getByTestId('mock-verovio-viewer')).toBeDefined();

    // Clicking retry button clears draft and routes to practice
    const retryButton = screen.getByRole('button', { name: /重弹一次/i });
    fireEvent.click(retryButton);
    fireEvent.click(screen.getByRole('button', { name: '确认离开' }));
    expect(completedPerformanceStore.getPerformance()).toBeNull();
    expect(navigationMocks.push).toHaveBeenCalledWith('/score/score-123/practice');
  });

  it('correctly categorizes note-by-note strike colors and all 5 outcome counters', () => {
    const applySpy = vi.spyOn(PerformanceAnnotationController.prototype, 'apply');

    const draftWithChordsAndOutcomes: CompletedPerformance = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { kind: 'FULL', startIndex: 0, endIndex: 4, startBeat: 0, terminalBeat: 20 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'MUSICXML' }],
      },
      inputSource: 'MICROPHONE',
      activeElapsedMs: 10000,
      evaluation: completeEvaluation([
            // 1. MATCH group with 2 matched strikes in a chord
            {
              expectedGroupId: 'g-1',
              performanceTimeMs: 0,
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
            // 4. Manual-stop tail group with a not-reached strike
            {
              expectedGroupId: 'g-4',
              performanceTimeMs: 3000,
              confidence: 0.4,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                { strikeId: 's-f4', pitch: 'F4', renderNoteIds: ['note-f4'], result: 'NOT_REACHED' },
              ],
              unexpectedPitches: [],
              renderNoteIds: ['note-f4'],
              measureNumbers: ['2'],
            },
            // 5. NOT_OBSERVED group
            {
              expectedGroupId: 'g-5',
              performanceTimeMs: 4000,
              confidence: 0,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                { strikeId: 's-a4', pitch: 'A4', renderNoteIds: ['note-a4'], result: 'NOT_REACHED' },
              ],
              unexpectedPitches: [],
              renderNoteIds: ['note-a4'],
              measureNumbers: ['3'],
            },
          ]),
      media: {
        status: 'READY',
        kind: 'AUDIO',
        blob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 10000,
      },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 10000, mediaStartMs: 0, mediaEndMs: 10000 }],
        nominalMediaDurationMs: 10000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    completedPerformanceStore.setPerformance(draftWithChordsAndOutcomes);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    // Check strike-level summary: 8 target notes, 4 correct, 2 missing, 2 not reached, 1 extra.
    expect(screen.getByText('目标音')).toBeDefined();
    expect(screen.getByText('正确击键')).toBeDefined();
    expect(screen.getByText('漏弹')).toBeDefined();
    expect(screen.getByText('未完成')).toBeDefined();
    expect(screen.getByText('额外演奏')).toBeDefined();
    expect(screen.getByText('8')).toBeDefined();
    expect(screen.getByText('4')).toBeDefined();
    expect(screen.getAllByText('2')).toHaveLength(2);
    expect(screen.getByText('这些目标音位于本次已完成演奏范围之外，因此没有计为漏弹。')).toBeDefined();

    // Verify note-by-note strike annotation:
    // Green (matched): note-c4, note-e4, note-g4, note-c5
    // Red (missing): note-b4, note-e5
    // Neutral (not reached): note-f4, note-a4 should NOT be in either
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
    const applySpy = vi.spyOn(PerformanceAnnotationController.prototype, 'apply');

    // Artifact has revision 'rev-2', while draft has revision 'rev-1'
    currentMockArtifact = createMockArtifact({ revisionId: 'rev-2' });

    const validDraft: CompletedPerformance = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { kind: 'FULL', startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'MUSICXML' }],
      },
      inputSource: 'MICROPHONE',
      activeElapsedMs: 3000,
      evaluation: completeEvaluation([
            {
              expectedGroupId: 'g-1',
              performanceTimeMs: 0,
              confidence: 0.9,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [{ strikeId: 's-1', pitch: 'C4', renderNoteIds: ['n-1'], result: 'MATCHED' }],
              unexpectedPitches: [],
              renderNoteIds: ['n-1'],
              measureNumbers: ['1'],
            },
          ]),
      media: {
        status: 'READY',
        kind: 'AUDIO',
        blob: new Blob(['audio-bytes'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 3000,
      },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    completedPerformanceStore.setPerformance(validDraft);

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
    const validDraft: CompletedPerformance = {
      localSessionId: 'sess-1',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { kind: 'FULL', startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }],
      },
      inputSource: 'MIDI',
      activeElapsedMs: 3000,
      evaluation: completeEvaluation(),
      media: {
        status: 'UNAVAILABLE',
        reason: 'PERMISSION_DENIED',
      },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    completedPerformanceStore.setPerformance(validDraft);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('本次录音不可用')).toBeDefined();
    expect(screen.getByText('未授予麦克风权限')).toBeDefined();
    expect(screen.queryByTestId('mock-replay-player')).toBeNull();

    // When audio is UNAVAILABLE, Save Performance button is disabled
    const saveBtn = screen.getByRole('button', { name: '保存演奏' });
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('disables score queries when draft is absent', () => {
    completedPerformanceStore.clearPerformance();

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
  });

  it('handles save performance flow with success state', async () => {
    const validDraft: CompletedPerformance = {
      localSessionId: 'sess-save',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { kind: 'FULL', startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }],
      },
      inputSource: 'MIDI',
      activeElapsedMs: 3000,
      evaluation: completeEvaluation(),
      media: {
        status: 'READY',
        kind: 'AUDIO',
        blob: new Blob(['audio'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 3000,
      },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    completedPerformanceStore.setPerformance(validDraft);
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-abc' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    const saveBtn = screen.getByRole('button', { name: '保存演奏' });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);

    fireEvent.click(saveBtn);

    expect(saveMutationMock.mutateAsync).toHaveBeenCalled();
    const saveCall = saveMutationMock.mutateAsync.mock.calls[0][0];
    expect(saveCall.scoreId).toBe('score-123');
    expect(saveCall.revisionId).toBe('rev-1');
    expect(saveCall.scope).toMatchObject({ kind: 'FULL' });
    expect(saveCall.artifactId).toBe('art-1');
    expect(saveCall.mediaKind).toBe('AUDIO');
    expect(saveCall.mediaBlob).toBeDefined();

    // After resolution, shows "已保存" and "查看我的演奏"
    await screen.findByText('已保存');
    expect(screen.getAllByText('查看我的演奏').length).toBeGreaterThanOrEqual(1);
  });

  it('exports and saves ready video review media without using the audio blob', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:video-export'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const createObjectURL = vi.mocked(URL.createObjectURL);
    const revokeObjectURL = vi.mocked(URL.revokeObjectURL);

    const videoBlob = new Blob(['video'], { type: 'video/webm' });
    const validDraft: CompletedPerformance = {
      localSessionId: 'sess-video-save',
      scoreId: 'score-123',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: { kind: 'FULL', startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
      tempoPlan: {
        selection: { mode: 'SCORE' },
        segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }],
      },
      inputSource: 'MICROPHONE',
      activeElapsedMs: 3000,
      evaluation: completeEvaluation(),
      media: {
        status: 'READY',
        kind: 'VIDEO',
        blob: videoBlob,
        mimeType: 'video/webm',
        durationMs: 3000,
      },
      recordingTimebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    completedPerformanceStore.setPerformance(validDraft);
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-video' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(createObjectURL).toHaveBeenCalledWith(videoBlob);

    fireEvent.click(screen.getByRole('button', { name: '保存演奏' }));
    const saveCall = saveMutationMock.mutateAsync.mock.calls[0][0];
    expect(saveCall.mediaKind).toBe('VIDEO');
    expect(saveCall.mediaBlob).toBe(videoBlob);
    expect(saveCall.mimeType).toBe('video/webm');

    await screen.findByText('已保存');
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:video-export');
    });
  });

  it('exports score plus video as a separate composited file without replacing original export or save', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) =>
        blob.type === 'video/webm' && blob.size === 12 ? 'blob:share-video-export' : 'blob:raw-video'
      ),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const createObjectURL = vi.mocked(URL.createObjectURL);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const videoBlob = new Blob(['raw-video'], { type: 'video/webm' });
    const draft = createVideoDraft({ videoBlob });
    completedPerformanceStore.setPerformance(draft);
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-video' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    fireEvent.click(screen.getByTestId('open-share-video-studio'));

    fireEvent.click(screen.getByTestId('generate-share-video'));

    await waitFor(() => {
      expect(shareVideoMocks.exportShareVideo).toHaveBeenCalled();
    });
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video/webm' })
    );
    expect(clickSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(createObjectURL).toHaveBeenCalledWith(videoBlob);

    fireEvent.click(screen.getByRole('button', { name: '保存演奏' }));
    await waitFor(() => expect(saveMutationMock.mutateAsync).toHaveBeenCalled());
    expect(saveMutationMock.mutateAsync.mock.calls[0][0].mediaKind).toBe('VIDEO');
  });

  it('disables score plus video export when score identity is mismatched and keeps raw video export available', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:raw-video'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    currentMockArtifact = createMockArtifact({ revisionId: 'rev-2' });
    completedPerformanceStore.setPerformance(createVideoDraft());

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    expect(screen.getByTestId('share-video-studio-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('open-share-video-studio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(shareVideoMocks.exportShareVideo).not.toHaveBeenCalled();
  });

  it('prevents parallel score-video exports and aborts the active export when cancelled', async () => {
    const resolveExportRef: Array<
      (value: { blob: Blob; mimeType: string; durationMs: number }) => void
    > = [];
    shareVideoMocks.exportShareVideo.mockImplementation(
      (_options: { signal: AbortSignal; onProgress?: (progress: { ratio: number }) => void }) => {
        _options.onProgress?.({ ratio: 0.25 });
        return new Promise((resolve) => {
          resolveExportRef[0] = resolve;
        });
      }
    );
    completedPerformanceStore.setPerformance(createVideoDraft());

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    fireEvent.click(screen.getByTestId('open-share-video-studio'));

    const exportButton = screen.getByTestId('generate-share-video');
    fireEvent.click(exportButton);
    fireEvent.click(exportButton);

    await screen.findByTestId('share-video-export-progress');
    expect(shareVideoMocks.exportShareVideo).toHaveBeenCalledTimes(1);
    expect(exportButton).toBeDisabled();

    const signal = shareVideoMocks.exportShareVideo.mock.calls[0][0].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: '取消合成' }));
    expect(signal.aborted).toBe(true);

    resolveExportRef[0]?.({
      blob: new Blob(['share-video'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 3000,
    });
  });

  it('shows export failure while preserving raw video export and video save actions', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:raw-video'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    shareVideoMocks.exportShareVideo.mockRejectedValueOnce(
      new Error('encoder failed')
    );
    completedPerformanceStore.setPerformance(createVideoDraft());
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-video' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    fireEvent.click(screen.getByTestId('open-share-video-studio'));
    fireEvent.click(screen.getByTestId('generate-share-video'));

    await screen.findByTestId('share-video-export-error');
    expect(screen.getByText('encoder failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(URL.createObjectURL).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存演奏' }));
    await waitFor(() => expect(saveMutationMock.mutateAsync).toHaveBeenCalled());
  });

  it('explains unsupported MP4 cloud save before calling the backend while local exports remain available', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:mp4-video'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    completedPerformanceStore.setPerformance(
      createVideoDraft({
        videoBlob: new Blob(['mp4-video'], { type: 'video/mp4' }),
        mimeType: 'video/mp4',
      })
    );

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(URL.createObjectURL).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存演奏' }));
    expect(saveMutationMock.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('当前服务端暂只支持保存 WebM 视频。你仍可以导出原始视频或乐谱＋视频文件。')).toBeInTheDocument();
  });

  it('keeps video orientation and score presentation independent when deriving export configs', async () => {
    completedPerformanceStore.setPerformance(createVideoDraft());

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByTestId('original-performance-card')).toBeInTheDocument();
    expect(screen.getByTestId('share-video-entry-card')).toBeInTheDocument();
    expect(screen.queryByTestId('share-video-studio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-share-video-studio'));
    expect(screen.getByTestId('share-video-studio')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('share-orientation-portrait'));
    fireEvent.click(screen.getByTestId('share-presentation-floating'));
    fireEvent.click(screen.getByTestId('share-floating-advanced-toggle'));
    fireEvent.click(screen.getByTestId('share-floating-position-bottom'));
    fireEvent.click(screen.getByTestId('share-floating-size-large'));

    expect(screen.getByTestId('share-floating-position-bottom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('share-floating-size-large')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('generate-share-video'));
    await waitFor(() => expect(shareVideoMocks.exportShareVideo).toHaveBeenCalled());
    expect(shareVideoMocks.exportShareVideo.mock.calls.at(-1)?.[0].config).toEqual({
      orientation: 'portrait',
      presentation: { kind: 'floating', position: 'bottom', size: 'large' },
    });

    fireEvent.click(screen.getByTestId('share-presentation-split'));
    fireEvent.click(screen.getByTestId('generate-share-video'));
    await waitFor(() => expect(shareVideoMocks.exportShareVideo).toHaveBeenCalledTimes(2));
    expect(shareVideoMocks.exportShareVideo.mock.calls.at(-1)?.[0].config).toEqual({
      orientation: 'portrait',
      presentation: { kind: 'split' },
    });
    expect(screen.queryByTestId('share-floating-position-bottom')).not.toBeInTheDocument();
  });

  it('keeps share selections when the studio is collapsed and reopened', () => {
    completedPerformanceStore.setPerformance(createVideoDraft());
    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    fireEvent.click(screen.getByTestId('open-share-video-studio'));
    fireEvent.click(screen.getByTestId('share-orientation-portrait'));
    fireEvent.click(screen.getByTestId('share-presentation-floating'));
    fireEvent.click(screen.getByTestId('share-floating-advanced-toggle'));
    fireEvent.click(screen.getByTestId('share-floating-position-bottom'));
    fireEvent.click(screen.getByTestId('share-floating-size-large'));
    fireEvent.click(screen.getByTestId('collapse-share-video-studio'));

    expect(screen.getByTestId('share-video-entry-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-share-video-studio'));

    expect(screen.getByTestId('share-orientation-portrait')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('share-presentation-floating')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('share-floating-position-bottom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('share-floating-size-large')).toHaveAttribute('aria-pressed', 'true');
  });
});

function createVideoDraft({
  videoBlob = new Blob(['video'], { type: 'video/webm' }),
  mimeType = videoBlob.type || 'video/webm',
}: {
  videoBlob?: Blob;
  mimeType?: string;
} = {}): CompletedPerformance {
  return {
    localSessionId: 'sess-video',
    scoreId: 'score-123',
    revisionId: 'rev-1',
    artifactId: 'art-1',
    scope: { kind: 'FULL', startIndex: 0, endIndex: 1, startBeat: 0, terminalBeat: 4 },
    tempoPlan: {
      selection: { mode: 'SCORE' },
      segments: [{ startBeat: 0, bpm: 80, source: 'CUSTOM' }],
    },
    inputSource: 'MICROPHONE',
      activeElapsedMs: 3000,
      evaluation: completeEvaluation(),
    media: {
      status: 'READY',
      kind: 'VIDEO',
      blob: videoBlob,
      mimeType,
      durationMs: 3000,
    },
    recordingTimebase: {
      activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
      nominalMediaDurationMs: 3000,
    },
    completedAt: '2026-09-20T12:00:00.000Z',
  };
}
