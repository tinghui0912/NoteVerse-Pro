import { recordingSinkFixture, ownedMediaFixture } from '@/lib/practice/__fixtures__/recording-sink';
import { releaseTransientReviewSession, createTransientReviewSession, type TransientReviewSession } from '@/lib/practice/review/transient-review-session';
import type { ContinuousPracticeCompletion } from '@/lib/practice/continuous/completion';
import { completedContinuousSessionFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { createContinuousPerformanceResult } from '@/lib/practice/result/continuous-performance-result';
import { planPractice } from '@/lib/practice/planning/practice-plan';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';
import type { PracticeTempoSelection } from '@/lib/practice/planning/tempo';
import { ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import englishPractice from '../../../../../../../../messages/en/practice.json';
import chinesePractice from '../../../../../../../../messages/zh/practice.json';

const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  scoreId: 'score-123',
}));

const translationMocks = vi.hoisted(() => {
  const practice: Record<string, string> = {
    videoExportPreviewCanvasLabel: "当前时间点画面预览",
    videoExportPreviewPreparing: "预览准备中...",
    videoExportPreviewSyncDesc: "预览与回放同步，不改变原始演奏录像。",
    videoExportPreviewSavePng: "保存当前预览 PNG",
    videoExportPreviewRetry: "重试预览",
    videoExportPreviewFailed: "视频预览失败",
    videoExportPreviewScoreFailed: "无法准备乐谱预览",
    videoExportPreviewCanvasFailed: "无法创建预览画布",
    videoExportPreviewDecodeFailed: "无法解码当前回放画面",
    videoExportPreviewFrameBufferFailed: "无法创建预览帧缓冲区",

    reviewTitle: '临时演奏报告',
    reviewExpiredTitle: '本次临时报告已失效',
    reviewExpiredDesc: '临时演奏报告仅在本次演奏结束后保留于当前页面会话中。刷新页面或重新打开后已失效。',
    backToPractice: '返回练习',
    backToScore: '返回乐谱',
    audioRecordingUnavailable: '本次录音不可用',
    audioRecordingUnavailableMicDenied: '未授予麦克风权限',
    audioRecordingUnavailableDesc: '由于未授予录音权限或设备不支持，本次演奏未录制音频。',
    performanceNotRecorded: '本次演奏未录制',
    performanceNotRecordedDesc: '本次练习已完成，但没有录制音频或视频。',
    performanceDuration: '演奏时长',
    performanceScope: '练习范围',
    performanceTempo: '演奏速度',
    performanceInput: '输入方式',
    inputSourceMic: '麦克风 (Acoustic)',
    inputSourceMidi: 'MIDI 键盘',
    scopeFull: '全曲演奏',
    scopeSection: '选段演奏',
    tempoScoreMode: '原速',
    takeScopeBeats: '第 {start} - {end} 拍',
    reviewCompletedAt: '完成时间：{time}',
    reviewLoadingScore: '正在加载乐谱...',
    performanceOutcomes: '音符匹配结果',
    performanceDetails: '演奏详情',
    evaluationUnavailableDesc: '本次演奏的识别分析不可用，仍可回放录制。',
    acousticEvidenceDesc: '麦克风结果表示声学识别证据；未归属的声学识别结果不会直接视为错音或多弹。',
    matchedGroupCount: '已匹配音符组',
    partialGroupCount: '部分匹配音符组',
    mismatchGroupCount: '错音音符组',
    unobservedGroupCount: '未观察到音符组',
    totalGroupCount: '总目标音符组',
    audioPlaybackFailed: '本次录音不可回放',
    saveRecording: '保存录制',
    recordingSaved: '已保存',
    savingRecording: '正在保存...',
    retrySaveRecording: '重试保存',
    viewMyPerformances: '查看我的演奏',
    saveRecordingSuccessTitle: '录制已保存',
    saveRecordingSuccessDesc: '可以稍后在已保存录制中查看。',
    saveRecordingFailedTitle: '保存失败',
    saveRecordingFailedDesc: '暂时无法保存这次演奏，请稍后重试。',
    exportOriginalVideo: '导出原始视频',
    exportScoreVideo: '导出乐谱＋视频',
    exportScoreVideoProgressTitle: '正在合成乐谱＋演奏视频',
    exportScoreVideoProgressDesc: '已处理 {progress}%。请保持页面打开。',
    cancelExportScoreVideo: '取消合成',
    exportScoreVideoFailedTitle: '合成导出失败',
    exportScoreVideoFailedDesc: '暂时无法合成这次乐谱＋演奏视频。原始视频和保存录制仍可继续使用。',
    exportScoreVideoUnavailableVideo: '需要一段可播放的本地视频才能合成导出。',
    exportScoreVideoUnavailableScore: '乐谱尚未准备好，暂不能可靠合成。',
    exportScoreVideoUnavailableScoreMismatch: '当前乐谱版本与录像不一致，暂不能可靠合成。',
    exportScoreVideoUnavailableSync: '缺少可靠的录像与乐谱时间映射，暂不能合成。',
    exportScoreVideoUnsupportedBrowser: '当前浏览器不支持本地视频合成导出。',
    saveRecordingMediaTooLarge: '本次媒体超过 100 MiB，暂不能保存到云端。你可以先导出原始视频。',
    retryPractice: '重弹一次',
    playback: '练习回放',
    videoExportEntryTitle: '导出乐谱视频',
    videoExportEntryDesc: '在本地将动态乐谱与演奏画面合成并下载。',
    videoExportOpenAction: '导出乐谱视频',
    videoExportCollapseStudio: '收起制作工具',
    videoExportTitle: '乐谱视频导出',
    videoExportDesc: '在浏览器中将动态乐谱与演奏画面合成为视频并下载。导出不会上传或发布视频。',
    videoExportOrientationStep: '1. 视频比例',
    videoExportOrientationDesc: '选择导出视频的画布方向。',
    videoExportLandscapeTitle: '横版 16:9',
    videoExportLandscapeDesc: '适合横向演奏视频。',
    videoExportPortraitTitle: '竖版 9:16',
    videoExportPortraitDesc: '适合手机和竖屏视频。',
    videoExportPresentationStep: '2. 乐谱呈现方式',
    videoExportPresentationDesc: '选择乐谱与演奏画面的组合方式。',
    videoExportSplitTitle: '分屏',
    videoExportSplitDesc: '完整乐谱与演奏对照。',
    videoExportFloatingTitle: '悬浮乐谱',
    videoExportFloatingDesc: '演奏为主，动态乐谱叠加。',
    videoExportDevPreview: '开发预览',
    videoExportPositionStep: '3. 乐谱位置',
    videoExportPositionDesc: '悬浮乐谱会遮挡下方部分演奏画面，请确认未挡住您希望展示的手部、键盘或人物。',
    videoExportAdjustPositionSize: '调整位置与大小',
    videoExportTop: '顶部',
    videoExportTopDesc: '靠近演奏画面上方。',
    videoExportBottom: '底部',
    videoExportBottomDesc: '靠近演奏画面下方。',
    videoExportScoreSize: '乐谱大小',
    videoExportSmall: '小',
    videoExportMedium: '中',
    videoExportLarge: '大',
    videoExportPreviewTitle: '实时合成预览',
    videoExportPreviewDesc: '与原始演奏回放同步。',
    videoExportPreviewTime: '预览时间：{time}',
    videoExportOutputTitle: '导出视频',
    videoExportAction: '生成并下载视频',
    videoExportTemplateSummary: '{orientation} · {presentation} · {position} · 原始音轨',
    videoExportTemplateSummaryWithoutPosition: '{orientation} · {presentation} · 原始音轨',
    leaveReviewTitle: '离开临时演奏报告？',
    leaveReviewDesc: '这份临时演奏报告离开后可能无法再次访问。合成视频下载不等于保存原始演奏。',
    leaveReviewUnsavedMediaDesc: '原始录音或录像尚未保存为正式演奏。离开或重新练习后，这份临时媒体可能无法再次访问；合成视频下载不等于保存原始演奏。',
    leaveReviewWhileExportingDesc: '合成视频正在生成。确认离开会取消当前合成任务；合成视频下载不等于保存原始演奏。',
    leaveReviewWhileExportingAndUnsavedDesc: '合成视频正在生成，确认离开会取消当前合成任务；同时，原始录音或录像尚未保存为正式演奏，离开后这份临时媒体可能无法再次访问。',
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
    locale: 'zh' as 'en' | 'zh',
    defaultPractice: translate(practice),
    practice: translate(practice),
  };
});

vi.mock('next-intl', async (importOriginal) => {
  const { createFormatter } = await importOriginal<typeof import('next-intl')>();
  return {
    useLocale: () => translationMocks.locale,
    useTranslations: () => translationMocks.practice,
    useFormatter: () => createFormatter({ locale: translationMocks.locale, timeZone: 'UTC' }),
  };
});

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


const createMockArtifact = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1 as const, ticksPerQuarter: 1, scoreId: 'score-123', revisionId: 'rev-1', artifactId: 'art-1',
   scoreEndTick: 20,
  notes: Array.from({ length: 5 }, (_, i) => ({ noteId: `note-${i+1}`, eventId: `event-${i+1}`, pianoKey: 60, renderNoteId: `n-${i+1}`, measureNumber: '1', staffId: '', voiceId: '', tieTypes: [] })),
  events: Array.from({ length: 5 }, (_, i) => ({ eventId: `event-${i+1}`, onsetTick: i*4, durationTicks: 4 })),
  moments: Array.from({ length: 5 }, (_, i) => ({ groupId: `g-${i+1}`, onsetTick: i*4, canonicalEndTick: (i+1)*4, attacks: [{ attackId: `strike-${i+1}`, pianoKey: 60, noteIds: [`note-${i+1}`] }], continuationNoteIds: [] })),
  scoreTempoSegments: [{ startTick: 0, bpm: 100 }],
  meterSegments: [{ startTick: 0, numerator: 4, denominator: 4,   }],
  ...overrides,
});

let currentMockArtifact = createMockArtifact();

const reviewWorkspace = { reviewSession: null as TransientReviewSession | null, clearReviewSession: vi.fn(() => { const session = reviewWorkspace.reviewSession; reviewWorkspace.reviewSession = null; return releaseTransientReviewSession(session); }) };
vi.mock('@/contexts/practice-workspace-context', () => ({ usePracticeWorkspace: () => reviewWorkspace }));
function provideReview(completion: ContinuousPracticeCompletion) {
  reviewWorkspace.reviewSession = createTransientReviewSession(completion, {
    sourceId: completion.result.session.plan.source.sourceId, artifact: currentMockArtifact, musicXml: '<score-partwise></score-partwise>',
  });
}

vi.mock('@/components/score-preview/verovio-score-viewer', () => ({
  VerovioScoreViewer: ({ onRendered, isLoading, xmlContent, loadingContent, emptyContent }: {
    onRendered?: (adapter: unknown, el: HTMLElement) => void;
    isLoading?: boolean; xmlContent?: string | null;
    loadingContent?: React.ReactNode; emptyContent?: React.ReactNode;
  }) => {
    if (isLoading) return <>{loadingContent}</>;
    if (!xmlContent) return <>{emptyContent}</>;
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

const videoExportMocks = vi.hoisted(() => ({
  exportVideo: vi.fn(),
  getVideoExportReadiness: vi.fn(),
}));

vi.mock('@/lib/practice/video-export/export', () => ({
  exportVideo: videoExportMocks.exportVideo,
  getVideoExportReadiness: videoExportMocks.getVideoExportReadiness,
}));

import PracticeReviewPage from './page';
import type { CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';
import { completedEvaluationFixture, finality } from '@/lib/practice/__fixtures__/continuous-evaluation';
import { EvaluationAnnotationController } from '@/lib/practice/score-view/evaluation-annotations';

type TestOutcome = {
  expectedGroupId: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI';
  expectedStrikeOutcomes: {
    strikeId: string;
    pianoKey: number;
    renderNoteIds: string[];
    result: 'MATCHED' | 'UNMATCHED' | 'NOT_REACHED';
  }[];
  unattributedKeys: number[];
  timingOffsetMs?: number;
  renderNoteIds?: string[];
  measureNumbers?: string[];
};

function completeEvaluation(
  outcomes: TestOutcome[] = [], inputSource: 'MIDI' | 'MICROPHONE' = 'MICROPHONE'
): CompletedContinuousEvaluation {
  return completedEvaluationFixture(inputSource, outcomes.map(outcome => ({
    groupId: outcome.expectedGroupId, performanceTimeMs: outcome.performanceTimeMs,
    state: 'FINALIZED', finality,
    strikes: outcome.expectedStrikeOutcomes.map((strike) => {
        const base = {
          strikeId: strike.strikeId,
          groupId: outcome.expectedGroupId,
          pianoKey: strike.pianoKey,
          expectedPerformanceTimeMs: outcome.performanceTimeMs,
          renderNoteIds: strike.renderNoteIds,
        };
        if (strike.result === 'MATCHED') {
          return {
            ...base,
            state: 'MATCHED' as const, finality,
            match: { observation: { observationId: `${strike.strikeId}:matched`, pianoKey: strike.pianoKey,
              performanceTimeMs: outcome.performanceTimeMs + (outcome.timingOffsetMs ?? 0), confidence: outcome.confidence, source: inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC' },
              timingOffsetMs: outcome.timingOffsetMs ?? 0 },
          };
        }
        return {
          ...base,
          state: strike.result, finality,
        };
      }),
  })), outcomes.flatMap(outcome => outcome.unattributedKeys.map((pianoKey, index) => ({
    observationId: `${outcome.expectedGroupId}:unattributed:${index}`, pianoKey, performanceTimeMs: outcome.performanceTimeMs,
    confidence: outcome.confidence, source: inputSource === 'MIDI' ? 'MIDI' as const : 'ACOUSTIC' as const,
  }))));
}

function reviewResult(options: {
  localSessionId: string; inputSource: PracticeInputSource; activeElapsedMs: number;
  tempoSelection: PracticeTempoSelection; evaluation: CompletedContinuousEvaluation; updatedAtMs: number;
}) {
  const groups = options.evaluation.status === 'COMPLETE' ? options.evaluation.assignment.groups : [];
  if (groups.length) {
    // The notation fixture describes the same canonical attacks as the evaluation fixture.
    currentMockArtifact = createMockArtifact({
      notes: groups.flatMap((group, i) => group.strikes.flatMap(strike => strike.renderNoteIds.map(noteId => ({
        noteId, renderNoteId: noteId, eventId: `event-${i}`, pianoKey: strike.pianoKey,
        measureNumber: '1', staffId: '', voiceId: '', tieTypes: [],
      })))),
      events: groups.map((_, i) => ({ eventId: `event-${i}`, onsetTick: i * 4, durationTicks: 4 })),
      moments: groups.map((group, i) => ({ groupId: group.groupId, onsetTick: i * 4, canonicalEndTick: (i + 1) * 4,
        attacks: group.strikes.map(strike => ({ attackId: strike.strikeId, pianoKey: strike.pianoKey, noteIds: strike.renderNoteIds })),
        continuationNoteIds: [],
      })), scoreEndTick: groups.length * 4,
    });
  }
  const plan = planPractice({ sourceId: 'source-fixture', artifact: currentMockArtifact }, {
    mode: 'CONTINUOUS_PLAY', inputSource: options.inputSource, recordingMode: 'OFF',
    scope: { kind: 'FULL' }, tempoSelection: options.tempoSelection, metronomeEnabled: false,
  });
  if (plan.mode !== 'CONTINUOUS_PLAY') throw new Error('Expected Continuous plan');
  const session = completedContinuousSessionFixture(plan, options);
  let evaluation = options.evaluation;
  if (evaluation.status === 'COMPLETE') {
    if (groups.length) evaluation = { ...evaluation, assignment: { ...evaluation.assignment, sessionDomainId: session.localSessionId } };
    else {
      const evaluator = new ContinuousEvaluationSession({ artifact: plan.source.artifact, scope: plan.scope,
        inputSource: options.inputSource, sessionDomainId: session.localSessionId, timeline: { tickToTimeMs: tick => tick * 500 } });
      evaluator.publish({ publicationId: 'coverage', sessionDomainId: session.localSessionId,
        observations: [], analyzedThroughPerformanceMs: 10000, availabilitySessionTimeMs: 10000 });
      evaluator.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilitySessionTimeMs: 10000 });
      evaluation = evaluator.completedEvaluation();
    }
  }
  return createContinuousPerformanceResult({ session, evaluation });
}

describe('PracticeReviewPage', () => {
  beforeEach(() => {
    translationMocks.locale = 'zh';
    translationMocks.practice = translationMocks.defaultPractice;
    navigationMocks.push.mockClear();
    reviewWorkspace.reviewSession = null;
    currentMockArtifact = createMockArtifact();
    vi.restoreAllMocks();
    saveMutationMock.mutateAsync.mockReset();
    videoExportMocks.exportVideo.mockReset();
    videoExportMocks.exportVideo.mockResolvedValue({
      blob: new Blob(['video-export'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationMs: 3000,
    });
    videoExportMocks.getVideoExportReadiness.mockImplementation(
      ({
        completion,
        session,
        isScoreIdentityConfirmed,
        xmlContent,
        scoreContainer,
      }: {
        completion: ContinuousPracticeCompletion | null;
        session?: { video?: { status?: string } } | null;
        isScoreIdentityConfirmed: boolean;
        xmlContent: string | null;
        scoreContainer: HTMLElement | null;
      }) => {
        if (completion?.recording.status !== 'READY' && session?.video?.status !== 'READY') {
          return { ok: false, reason: 'video_not_ready' };
        }
        if (!isScoreIdentityConfirmed) return { ok: false, reason: 'score_identity_mismatch' };
        if (!xmlContent || !scoreContainer) return { ok: false, reason: 'score_not_ready' };
        return { ok: true, mimeType: 'video/webm' };
      }
    );
  });

  it('renders expired empty state when completion is absent', () => {
    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
    expect(
      screen.getByText('临时演奏报告仅在本次演奏结束后保留于当前页面会话中。刷新页面或重新打开后已失效。')
    ).toBeDefined();

    const backButton = screen.getByRole('button', { name: /返回练习/i });
    fireEvent.click(backButton);
    expect(navigationMocks.push).toHaveBeenCalledWith('/score/score-123/practice/setup');
  });

  it.each(['en', 'zh'] as const)('localizes the %s SCORE/RANGE review from its complete handoff', async locale => {
    const { createTranslator } = await vi.importActual<typeof import('next-intl')>('next-intl');
    translationMocks.locale = locale;
    translationMocks.practice = createTranslator({
      locale,
      messages: (locale === 'en' ? englishPractice : chinesePractice) as Record<string, string>,
      onError: error => { throw error; },
    });
    const completion = createVideoCompletion();
    const plan = planPractice(completion.result.session.plan.source, {
      mode: 'CONTINUOUS_PLAY', inputSource: 'MICROPHONE', recordingMode: 'OFF', metronomeEnabled: false,
      scope: { kind: 'RANGE', startGroupId: 'g-2', endGroupId: 'g-2' }, tempoSelection: { mode: 'SCORE' },
    });
    if (plan.mode !== 'CONTINUOUS_PLAY') throw new Error('Expected Continuous');
    provideReview({ ...completion, result: createContinuousPerformanceResult({
      session: completedContinuousSessionFixture(plan, { updatedAtMs: completion.result.session.updatedAtMs }),
      evaluation: { status: 'UNAVAILABLE', inputSource: 'MICROPHONE', assignmentPolicyId: 'CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5', reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' },
    }) });

    const view = render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    expect(screen.getByText(locale === 'en' ? 'Score Tempo' : '原速')).toBeInTheDocument();
    expect(screen.getByText(locale === 'en'
      ? 'Section Performance (Beats 4 - 8)' : '选段演奏 (第 4 - 8 拍)')).toBeInTheDocument();
    const completedTime = new Intl.DateTimeFormat(locale, {
      hour: 'numeric', minute: '2-digit', second: '2-digit',
    }).format(new Date(completion.result.session.updatedAtMs));
    expect(screen.getByText(locale === 'en' ? `Completed at ${completedTime}` : `完成时间：${completedTime}`)).toBeInTheDocument();
    expect(screen.getByTestId('mock-verovio-viewer')).toBeInTheDocument();
    if (locale === 'en') {
      expect(view.container.textContent).not.toMatch(/原曲速度|拍|完成时间|正在加载乐谱|乐谱未加载/);
    }
    expect(saveMutationMock.mutateAsync).not.toHaveBeenCalled();
  });

  it('renders expired empty state when handoff scoreId does not match url', () => {
    currentMockArtifact = createMockArtifact({ scoreId: 'score-OTHER' });
    provideReview({
      result: reviewResult({
        localSessionId: 'sess-1',
        inputSource: 'MICROPHONE',
        activeElapsedMs: 0,
        tempoSelection: { mode: 'SCORE' },
        evaluation: completeEvaluation(),
        updatedAtMs: Date.parse(new Date().toISOString()),
      }), recording: { status: 'UNAVAILABLE', reason: 'NONE' }
    });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
  });

  it('renders full review report with player when valid completion has audio READY', () => {
    const validCompletion: ContinuousPracticeCompletion = {
      result: reviewResult({
        localSessionId: 'sess-1',
        inputSource: 'MICROPHONE',
        activeElapsedMs: 9600,
        tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 100 },
        evaluation: completeEvaluation([
          {
            expectedGroupId: 'g-1',
            performanceTimeMs: 0,
            confidence: 0.9,
            source: 'ACOUSTIC',
            expectedStrikeOutcomes: [
              { strikeId: 's-1', pianoKey: 60, renderNoteIds: ['n-1'], result: 'MATCHED' },
            ],
            unattributedKeys: [],
            renderNoteIds: ['n-1'],
            measureNumbers: ['1'],
          },
          {
            expectedGroupId: 'g-2',
            performanceTimeMs: 600,
            confidence: 0.7,
            source: 'ACOUSTIC',
            expectedStrikeOutcomes: [
              { strikeId: 's-2', pianoKey: 62, renderNoteIds: ['n-2'], result: 'NOT_REACHED' },
            ],
            unattributedKeys: [],
            renderNoteIds: ['n-2'],
            measureNumbers: ['1'],
          },
        ]),
        updatedAtMs: Date.parse('2026-09-20T12:00:00.000Z'),
      }), recording: {
        status: 'READY',
        kind: 'AUDIO',
        media: ownedMediaFixture(new Blob(['audio-bytes'], { type: 'audio/webm' })),
        mimeType: 'audio/webm',
        durationMs: 9600,
        timebase: {
          activeSegments: [{ perfStartMs: 0, perfEndMs: 9600, mediaStartMs: 0, mediaEndMs: 9600 }],
          nominalMediaDurationMs: 9600,
        }
      }
    };

    provideReview(validCompletion);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('临时演奏报告')).toBeDefined();
    expect(screen.getByText('00:09')).toBeDefined(); // 9600ms = 9s
    expect(screen.getByText('100 BPM')).toBeDefined();
    expect(screen.getByText('麦克风 (Acoustic)')).toBeDefined();
    expect(screen.getByText(`全曲演奏 (第 0 - ${validCompletion.result.session.plan.scope.terminalTick} 拍)`)).toBeDefined();

    for (const label of ['目标音', '正确', '错音', '漏弹', '未完成', '已识别目标音', '未确认目标音', '额外音', '额外演奏']) {
      expect(screen.queryByText(label, { exact: true })).toBeNull();
    }

    // Player should be rendered
    expect(screen.getByTestId('mock-replay-player')).toBeDefined();
    expect(screen.getByTestId('mock-verovio-viewer')).toBeDefined();

    // Clicking retry button clears completion and routes to Setup for a fresh retained binding
    const retryButton = screen.getByRole('button', { name: /重弹一次/i });
    fireEvent.click(retryButton);
    fireEvent.click(screen.getByRole('button', { name: '确认离开' }));
    expect(reviewWorkspace.reviewSession).toBeNull();
    expect(navigationMocks.push).toHaveBeenCalledWith('/score/score-123/practice/setup?practiceRevisionId=rev-1');
  });

  it.each(['MIDI','MICROPHONE'] as const)('%s review has no aggregate cards and keeps completed annotation semantics', (inputSource) => {
    const applySpy = vi.spyOn(EvaluationAnnotationController.prototype, 'apply');

    const completionWithChordsAndOutcomes: ContinuousPracticeCompletion = {
      result: reviewResult({
        localSessionId: 'sess-1',
        inputSource: inputSource,
        activeElapsedMs: 10000,
        tempoSelection: { mode: 'SCORE' },
        evaluation: completeEvaluation(
          [
            // 1. MATCH group with 2 matched strikes in a chord
            {
              expectedGroupId: 'g-1',
              performanceTimeMs: 0,
              confidence: 0.95,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                {
                  strikeId: 's-c4',
                  pianoKey: 60,
                  renderNoteIds: ['note-c4'],
                  result: 'MATCHED',
                },
                {
                  strikeId: 's-e4',
                  pianoKey: 64,
                  renderNoteIds: ['note-e4'],
                  result: 'MATCHED',
                },
              ],
              unattributedKeys: [],
              renderNoteIds: ['note-c4', 'note-e4'],
              measureNumbers: ['1'],
            },
            // 2. One matched and one unmatched target
            {
              expectedGroupId: 'g-2',
              performanceTimeMs: 1000,
              confidence: 0.7,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                {
                  strikeId: 's-g4',
                  pianoKey: 67,
                  renderNoteIds: ['note-g4'],
                  result: 'MATCHED',
                },
                {
                  strikeId: 's-b4',
                  pianoKey: 71,
                  renderNoteIds: ['note-b4'],
                  result: 'UNMATCHED',
                },
              ],
              unattributedKeys: [],
              renderNoteIds: ['note-g4', 'note-b4'],
              measureNumbers: ['1'],
            },
            // 3. One supported target and one unattributed physical observation
            {
              expectedGroupId: 'g-3',
              performanceTimeMs: 2000,
              confidence: 0.3,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                {
                  strikeId: 's-c5',
                  pianoKey: 72,
                  renderNoteIds: ['note-c5'],
                  result: 'MATCHED',
                },
                {
                  strikeId: 's-e5',
                  pianoKey: 76,
                  renderNoteIds: ['note-e5'],
                  result: 'UNMATCHED',
                },
              ],
              unattributedKeys: [75],
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
                {
                  strikeId: 's-f4',
                  pianoKey: 65,
                  renderNoteIds: ['note-f4'],
                  result: 'NOT_REACHED',
                },
              ],
              unattributedKeys: [],
              renderNoteIds: ['note-f4'],
              measureNumbers: ['2'],
            },
            // 5. Another target beyond terminal coverage
            {
              expectedGroupId: 'g-5',
              performanceTimeMs: 4000,
              confidence: 0,
              source: 'ACOUSTIC',
              expectedStrikeOutcomes: [
                {
                  strikeId: 's-a4',
                  pianoKey: 69,
                  renderNoteIds: ['note-a4'],
                  result: 'NOT_REACHED',
                },
              ],
              unattributedKeys: [],
              renderNoteIds: ['note-a4'],
              measureNumbers: ['3'],
            },
          ],
          inputSource,
        ),
        updatedAtMs: Date.parse('2026-09-20T12:00:00.000Z'),
      }), recording: {
        status: 'READY',
        kind: 'AUDIO',
        media: ownedMediaFixture(new Blob(['audio-bytes'], { type: 'audio/webm' })),
        mimeType: 'audio/webm',
        durationMs: 10000,
        timebase: {
          activeSegments: [{ perfStartMs: 0, perfEndMs: 10000, mediaStartMs: 0, mediaEndMs: 10000 }],
          nominalMediaDurationMs: 10000,
        }
      }
    };

    provideReview(completionWithChordsAndOutcomes);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    for (const label of ['目标音', '正确', '错音', '漏弹', '未完成', '已识别目标音', '未确认目标音', '额外音']) {
      expect(screen.queryByText(label, { exact: true })).toBeNull();
    }
    expect(screen.queryByRole('region', { name: /目标音结果|目标音识别|额外演奏/ })).toBeNull();
    expect(screen.getByTestId('mock-replay-player')).toBeDefined();

    // Verify note-by-note strike annotation:
    // Green (matched): note-c4, note-e4, note-g4, note-c5
    // Unsupported targets are red for both input sources.
    // Neutral (not reached): note-f4, note-a4 should NOT be in either
    expect(applySpy).toHaveBeenCalled();
    const lastCall = applySpy.mock.calls[applySpy.mock.calls.length - 1];
    const annotations = lastCall[1];
    expect(annotations.supportedNoteIds).toEqual(
      expect.arrayContaining(['note-c4', 'note-e4', 'note-g4', 'note-c5'])
    );
    expect(annotations.unsupportedNoteIds).toEqual(
      ['note-b4', 'note-e5']
    );
    expect(annotations.supportedNoteIds).not.toContain('note-f4');
    expect(annotations.supportedNoteIds).not.toContain('note-a4');
    expect(annotations.unsupportedNoteIds).not.toContain('note-f4');
    expect(annotations.unsupportedNoteIds).not.toContain('note-a4');
  });

  it('keeps replay and a clear notice when completed evaluation is unavailable, without aggregate cards', () => {
    const result = reviewResult({
      localSessionId: 'unavailable',
      inputSource: 'MICROPHONE',
      activeElapsedMs: 3000,
      tempoSelection: { mode: 'SCORE' },
      evaluation: {
        status: 'UNAVAILABLE',
        inputSource: 'MICROPHONE',
        assignmentPolicyId: 'CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5',
        reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE',
      },
      updatedAtMs: Date.parse('2026-09-20T12:00:00.000Z'),
    });
    provideReview({ result, recording: {  status: 'READY', kind: 'AUDIO', media: ownedMediaFixture(new Blob(['audio'], { type: 'audio/webm' })),
      mimeType: 'audio/webm', durationMs: 3000, timebase: { activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }], nominalMediaDurationMs: 3000 } } });
    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    expect(screen.getByText('本次演奏的识别分析不可用，仍可回放录制。')).toBeDefined();
    expect(screen.getByTestId('mock-replay-player')).toBeDefined();
    expect(screen.queryByRole('region', { name: /目标音结果|目标音识别|额外演奏/ })).toBeNull();
  });

  it('renders notice when audio recording is UNAVAILABLE due to denied mic permission', () => {
    const validCompletion: ContinuousPracticeCompletion = {
      result: reviewResult({
        localSessionId: 'sess-1',
        inputSource: 'MIDI',
        activeElapsedMs: 3000,
        tempoSelection: { mode: 'SCORE' },
        evaluation: completeEvaluation([], 'MIDI'),
        updatedAtMs: Date.parse('2026-09-20T12:00:00.000Z'),
      }), recording: {
        status: 'UNAVAILABLE',
        reason: 'PERMISSION_DENIED',
      }
    };

    provideReview(validCompletion);

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('本次录音不可用')).toBeDefined();
    expect(screen.getByText('未授予麦克风权限')).toBeDefined();
    expect(screen.queryByTestId('mock-replay-player')).toBeNull();

    // When audio is UNAVAILABLE, Save Performance button is disabled
    const saveBtn = screen.getByRole('button', { name: '保存录制' });
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  it('renders expired Review without a handoff', () => {
    reviewWorkspace.reviewSession = null;

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByText('本次临时报告已失效')).toBeDefined();
  });

  it('handles save performance flow with success state', async () => {
    const validCompletion: ContinuousPracticeCompletion = {
      result: reviewResult({
        localSessionId: 'sess-save',
        inputSource: 'MIDI',
        activeElapsedMs: 3000,
        tempoSelection: { mode: 'SCORE' },
        evaluation: completeEvaluation([], 'MIDI'),
        updatedAtMs: Date.parse('2026-09-20T12:00:00.000Z'),
      }), recording: {
        status: 'READY',
        kind: 'AUDIO',
        media: ownedMediaFixture(new Blob(['audio'], { type: 'audio/webm' })),
        mimeType: 'audio/webm',
        durationMs: 3000,
        timebase: {
          activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
          nominalMediaDurationMs: 3000,
        }
      }
    };

    provideReview(validCompletion);
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-abc' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    const saveBtn = screen.getByRole('button', { name: '保存录制' });
    expect(saveBtn.hasAttribute('disabled')).toBe(false);
    expect(saveMutationMock.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(saveBtn);

    expect(saveMutationMock.mutateAsync).toHaveBeenCalled();
    const saveCall = saveMutationMock.mutateAsync.mock.calls[0][0];
    expect(saveCall.sourceId).toBe('source-fixture');
    expect(saveCall.scope).toMatchObject({ kind: 'FULL' });
    expect(saveCall.mediaKind).toBe('AUDIO');
    expect(saveCall.media.blob).toBeDefined();
    for (const key of ['result', 'evaluation', 'metrics', 'assignment', 'interpretation', 'provenance']) expect(saveCall).not.toHaveProperty(key);

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
    const validCompletion: ContinuousPracticeCompletion = {
      result: reviewResult({
        localSessionId: 'sess-video-save',
        inputSource: 'MICROPHONE',
        activeElapsedMs: 3000,
        tempoSelection: { mode: 'SCORE' },
        evaluation: completeEvaluation(),
        updatedAtMs: Date.parse('2026-09-20T12:00:00.000Z'),
      }), recording: {
        status: 'READY',
        kind: 'VIDEO',
        media: ownedMediaFixture(videoBlob),
        mimeType: 'video/webm',
        durationMs: 3000,
        timebase: {
          activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
          nominalMediaDurationMs: 3000,
        }
      }
    };

    provideReview(validCompletion);
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-video' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(createObjectURL).toHaveBeenCalledWith(videoBlob);

    fireEvent.click(screen.getByRole('button', { name: '保存录制' }));
    const saveCall = saveMutationMock.mutateAsync.mock.calls[0][0];
    expect(saveCall.mediaKind).toBe('VIDEO');
    expect(saveCall.media.blob).toBe(videoBlob);
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
        blob.type === 'video/webm' && blob.size === 12 ? 'blob:video-export' : 'blob:raw-video'
      ),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const createObjectURL = vi.mocked(URL.createObjectURL);

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const videoBlob = new Blob(['raw-video'], { type: 'video/webm' });
    const completion = createVideoCompletion({ videoBlob });
    provideReview(completion);
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-video' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    fireEvent.click(screen.getByTestId('open-video-export-studio'));

    fireEvent.click(screen.getByTestId('generate-video-export'));

    await waitFor(() => {
      expect(videoExportMocks.exportVideo).toHaveBeenCalled();
    });
    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'video/webm' })
    );
    expect(clickSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(createObjectURL).toHaveBeenCalledWith(videoBlob);

    fireEvent.click(screen.getByRole('button', { name: '保存录制' }));
    await waitFor(() => expect(saveMutationMock.mutateAsync).toHaveBeenCalled());
    expect(saveMutationMock.mutateAsync.mock.calls[0][0].mediaKind).toBe('VIDEO');
  });

  it.each(['success', 'error', 'abort'] as const)('keeps its source after Review clear until VideoExport %s settles', async outcome => {
    const capture = recordingSinkFixture(); await capture.sink.append(new Blob(['raw video'])); const media = await capture.sink.seal('video/webm');
    provideReview(createVideoCompletion({ videoBlob: media.blob, media }));
    await media.release();
    let resolve!: (output: { blob: Blob; mimeType: string; durationMs: number }) => void, reject!: (error: Error) => void;
    videoExportMocks.exportVideo.mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no; }));
    const view = render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    fireEvent.click(screen.getByTestId('open-video-export-studio'));
    fireEvent.click(screen.getByTestId('generate-video-export'));
    await waitFor(() => expect(videoExportMocks.exportVideo).toHaveBeenCalledOnce());
    await act(async () => { await reviewWorkspace.clearReviewSession(); });
    view.unmount(); expect(capture.exists()).toBe(true);
    const signal = videoExportMocks.exportVideo.mock.calls[0][0].signal as AbortSignal;
    expect(signal.aborted).toBe(true);
    await act(async () => {
      if (outcome === 'success') resolve({ blob: new Blob(['output'], { type: 'video/webm' }), mimeType: 'video/webm', durationMs: 100 });
      else reject(outcome === 'abort' ? new DOMException('cancelled', 'AbortError') : new Error('encoder failed'));
    });
    await waitFor(() => expect(capture.exists()).toBe(false)); expect(capture.remove).toHaveBeenCalledOnce();
  });

  it('prevents parallel score-video exports and aborts the active export when cancelled', async () => {
    const resolveExportRef: Array<
      (value: { blob: Blob; mimeType: string; durationMs: number }) => void
    > = [];
    videoExportMocks.exportVideo.mockImplementation(
      (_options: { signal: AbortSignal; onProgress?: (progress: { ratio: number }) => void }) => {
        _options.onProgress?.({ ratio: 0.25 });
        return new Promise((resolve) => {
          resolveExportRef[0] = resolve;
        });
      }
    );
    provideReview(createVideoCompletion());

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    fireEvent.click(screen.getByTestId('open-video-export-studio'));

    const exportButton = screen.getByTestId('generate-video-export');
    fireEvent.click(exportButton);
    fireEvent.click(exportButton);

    await screen.findByTestId('video-export-progress');
    expect(videoExportMocks.exportVideo).toHaveBeenCalledTimes(1);
    expect(exportButton).toBeDisabled();

    const signal = videoExportMocks.exportVideo.mock.calls[0][0].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: '取消合成' }));
    expect(signal.aborted).toBe(true);

    resolveExportRef[0]?.({
      blob: new Blob(['video-export'], { type: 'video/webm' }),
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
    videoExportMocks.exportVideo.mockRejectedValueOnce(
      new Error('encoder failed')
    );
    provideReview(createVideoCompletion());
    saveMutationMock.mutateAsync.mockResolvedValueOnce({ take_id: 'take-video' });

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);
    fireEvent.click(screen.getByTestId('open-video-export-studio'));
    fireEvent.click(screen.getByTestId('generate-video-export'));

    await screen.findByTestId('video-export-error');
    expect(screen.getByText('encoder failed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(URL.createObjectURL).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存录制' }));
    await waitFor(() => expect(saveMutationMock.mutateAsync).toHaveBeenCalled());
  });

  it('saves the same raw MP4 video and downloads it with its actual extension', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:mp4-video'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    const rawMp4 = new Blob(['mp4-video'], { type: 'video/mp4' });
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    provideReview(
      createVideoCompletion({
        videoBlob: rawMp4,
        mimeType: 'video/mp4',
      })
    );

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    fireEvent.click(screen.getByRole('button', { name: '导出原始视频' }));
    expect(URL.createObjectURL).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存录制' }));
    await waitFor(() => expect(saveMutationMock.mutateAsync).toHaveBeenCalledOnce());
    const saved = saveMutationMock.mutateAsync.mock.calls[0][0];
    expect(saved).toMatchObject({ mediaKind: 'VIDEO', mimeType: 'video/mp4' });
    expect(saved.media.blob).toBe(rawMp4);
    expect(URL.createObjectURL).toHaveBeenCalledWith(rawMp4);
    expect((download.mock.instances[0] as HTMLAnchorElement).download).toMatch(/\.mp4$/);
    download.mockRestore();
  });

  it('keeps video orientation and score presentation independent when deriving export configs', async () => {
    provideReview(createVideoCompletion());

    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    expect(screen.getByTestId('original-performance-card')).toBeInTheDocument();
    expect(screen.getByTestId('video-export-entry-card')).toBeInTheDocument();
    expect(screen.queryByTestId('video-export-studio')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-video-export-studio'));
    expect(screen.getByTestId('video-export-studio')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('video-export-orientation-portrait'));
    fireEvent.click(screen.getByTestId('video-export-presentation-floating'));
    fireEvent.click(screen.getByTestId('video-export-floating-advanced-toggle'));
    fireEvent.click(screen.getByTestId('video-export-floating-position-bottom'));
    fireEvent.click(screen.getByTestId('video-export-floating-size-large'));

    expect(screen.getByTestId('video-export-floating-position-bottom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('video-export-floating-size-large')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('generate-video-export'));
    await waitFor(() => expect(videoExportMocks.exportVideo).toHaveBeenCalled());
    expect(videoExportMocks.exportVideo.mock.calls.at(-1)?.[0].config).toEqual({
      orientation: 'portrait',
      presentation: { kind: 'floating', position: 'bottom', size: 'large' },
    });

    fireEvent.click(screen.getByTestId('video-export-presentation-split'));
    fireEvent.click(screen.getByTestId('generate-video-export'));
    await waitFor(() => expect(videoExportMocks.exportVideo).toHaveBeenCalledTimes(2));
    expect(videoExportMocks.exportVideo.mock.calls.at(-1)?.[0].config).toEqual({
      orientation: 'portrait',
      presentation: { kind: 'split' },
    });
    expect(screen.queryByTestId('video-export-floating-position-bottom')).not.toBeInTheDocument();
  });

  it('keeps export selections when the studio is collapsed and reopened', () => {
    provideReview(createVideoCompletion());
    render(<PracticeReviewPage params={Promise.resolve({ id: 'score-123' })} />);

    fireEvent.click(screen.getByTestId('open-video-export-studio'));
    fireEvent.click(screen.getByTestId('video-export-orientation-portrait'));
    fireEvent.click(screen.getByTestId('video-export-presentation-floating'));
    fireEvent.click(screen.getByTestId('video-export-floating-advanced-toggle'));
    fireEvent.click(screen.getByTestId('video-export-floating-position-bottom'));
    fireEvent.click(screen.getByTestId('video-export-floating-size-large'));
    fireEvent.click(screen.getByTestId('collapse-video-export-studio'));

    expect(screen.getByTestId('video-export-entry-card')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('open-video-export-studio'));

    expect(screen.getByTestId('video-export-orientation-portrait')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('video-export-presentation-floating')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('video-export-floating-position-bottom')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('video-export-floating-size-large')).toHaveAttribute('aria-pressed', 'true');
  });
});

function createVideoCompletion({
  videoBlob = new Blob(['video'], { type: 'video/webm' }),
  mimeType = videoBlob.type || 'video/webm',
  media,
}: {
  videoBlob?: Blob;
  mimeType?: string;
  media?: import('@/lib/practice/recording/owned-media').OwnedMediaHandle;
} = {}): ContinuousPracticeCompletion {
  return {
    result: reviewResult({
      localSessionId: 'sess-video',
      inputSource: 'MICROPHONE',
      activeElapsedMs: 3000,
      tempoSelection: { mode: 'SCORE' },
      evaluation: completeEvaluation(),
      updatedAtMs: Date.parse('2026-09-20T12:00:00.000Z'),
    }), recording: {
      status: 'READY',
      kind: 'VIDEO',
      media: media ?? ownedMediaFixture(videoBlob),
      mimeType,
      durationMs: 3000,
      timebase: {
        activeSegments: [{ perfStartMs: 0, perfEndMs: 3000, mediaStartMs: 0, mediaEndMs: 3000 }],
        nominalMediaDurationMs: 3000,
      }
    }
  };
}
