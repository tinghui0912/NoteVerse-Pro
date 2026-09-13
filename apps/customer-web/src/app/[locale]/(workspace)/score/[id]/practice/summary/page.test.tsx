// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PracticeSummaryPage from './page';
import type {
  PracticeSessionDetailRead,
  PracticeSessionResultSummaryRead,
  PracticeSessionSummaryPayloadRead,
  SavedPracticeReplayArtifactRead,
} from '@/generated/practice-api';
import type { PlayablePerformanceReplay } from '@/lib/practice/performance-replay';

const navigationMocks = vi.hoisted(() => ({
  back: vi.fn(),
  scoreId: 'score-1',
  sessionId: 'session-1' as string | null,
}));

const apiMocks = vi.hoisted(() => ({
  getPracticeSession: vi.fn(),
  getPracticeSessionSummary: vi.fn(),
  listPracticeReplayArtifacts: vi.fn(),
  getPracticeReplayArtifactPlaybackUrl: vi.fn(),
  authorizePracticeReplayUpload: vi.fn(),
  uploadPracticeReplayObject: vi.fn(),
  finalizePracticeReplayArtifact: vi.fn(),
}));

const practiceContentMocks = vi.hoisted(() => ({
  readyContentArgs: [] as Array<[string, string | null | undefined]>,
}));

const observabilityMocks = vi.hoisted(() => ({
  reportUnexpectedClientError: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

const localReplayStoreMocks = vi.hoisted(() => ({
  readPlayablePerformanceReplay: vi.fn(),
}));

const playheadMocks = vi.hoisted(() => ({
  applyPerformanceTime: vi.fn(),
  clear: vi.fn(),
}));

const translationMocks = vi.hoisted(() => {
  const practice: Record<string, string> = {
    analysisFailedDesc: 'Analysis failed.',
    analysisFailedTitle: 'Analysis Failed',
    backToPractice: 'Back to Practice',
    confirmedCorrectStrikes: 'Correct strikes',
    extraPitchCount: 'Extra playing',
    focusMeasure: 'Focus',
    loadingSummary: 'Loading practice summary...',
    loadingSummaryScore: 'Loading score annotations...',
    measureNumber: 'Measure {number}',
    mismatches: 'Wrong',
    missingPitchesLabel: 'Missing',
    missingStrikes: 'Missing strikes',
    partials: 'Partial',
    performanceProblemMeasures: 'Measures needing attention',
    performanceReportUnavailableDesc: 'This practice session does not have a performance report.',
    performanceSummarySubtitle: 'Replay this performance and review reliable results.',
    performanceSummaryTitle: 'Performance Summary',
    playback: 'Playback',
    playReplay: 'Replay',
    problemMeasureCount: '{count} measures needing attention',
    reviewReasonIncomplete: 'Unresolved target in this measure',
    reviewReasonNeedsAttention: 'Review this measure',
    reviewReasonPartialNotes: 'Partial notes were recorded here',
    reviewReasonWrongNotes: 'Wrong notes were recorded here',
    replaySeek: 'Replay position',
    savePerformance: 'Save Performance',
    savePerformanceFailedDesc: 'This performance could not be saved.',
    savePerformanceFailedTitle: 'Save failed',
    savePerformanceSuccessDesc: 'You can replay this performance from the report later.',
    savePerformanceSuccessTitle: 'Performance saved',
    savedReplayPlaybackFailed: 'This saved performance could not be played.',
    scoreAnnotations: 'Annotated score',
    scoreAnnotationsUnavailable: 'Score annotations are unavailable.',
    summary: 'Summary',
    summaryInvalidSession: 'This practice summary does not belong to the current score.',
    summaryMissingSession: 'This practice summary is missing a practice session.',
    unexpectedPitchesLabel: 'Extra playing',
  };
  const errors: Record<string, string> = {};

  function translate(dictionary: Record<string, string>) {
    const t = (key: string, values?: Record<string, string | number>) => {
      const template = dictionary[key] ?? key;
      return Object.entries(values ?? {}).reduce(
        (message, [name, value]) => message.replace(`{${name}}`, String(value)),
        template
      );
    };
    t.has = (key: string) => Object.prototype.hasOwnProperty.call(dictionary, key);
    return t;
  }

  return {
    errors: translate(errors),
    practice: translate(practice),
  };
});

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (namespace: string) =>
    namespace === 'practice' ? translationMocks.practice : translationMocks.errors,
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: navigationMocks.scoreId }),
  useRouter: () => ({
    back: navigationMocks.back,
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'sessionId' ? navigationMocks.sessionId : null),
  }),
}));

vi.mock('@/lib/api', () => ({
  practiceApi: {
    authorizePracticeReplayUpload: (...args: unknown[]) =>
      apiMocks.authorizePracticeReplayUpload(...args),
    finalizePracticeReplayArtifact: (...args: unknown[]) =>
      apiMocks.finalizePracticeReplayArtifact(...args),
    getPracticeReplayArtifactPlaybackUrl: (...args: unknown[]) =>
      apiMocks.getPracticeReplayArtifactPlaybackUrl(...args),
    getPracticeSession: (...args: unknown[]) => apiMocks.getPracticeSession(...args),
    getPracticeSessionSummary: (...args: unknown[]) =>
      apiMocks.getPracticeSessionSummary(...args),
    listPracticeReplayArtifacts: (...args: unknown[]) =>
      apiMocks.listPracticeReplayArtifacts(...args),
    uploadPracticeReplayObject: (...args: unknown[]) =>
      apiMocks.uploadPracticeReplayObject(...args),
  },
}));

vi.mock('@/lib/observability', () => ({
  reportUnexpectedClientError: (...args: unknown[]) =>
    observabilityMocks.reportUnexpectedClientError(...args),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMocks.toast }),
}));

vi.mock('@/lib/practice/local-performance-replay-store', () => ({
  readPlayablePerformanceReplay: (...args: unknown[]) =>
    localReplayStoreMocks.readPlayablePerformanceReplay(...args),
}));

vi.mock('@/components/practice/performance-replay-player', () => ({
  PerformanceReplayPlayer: ({
    actions,
    autoStart,
    onReplayTimeChange,
    replay,
  }: {
    actions?: ReactNode;
    autoStart?: boolean;
    onReplayTimeChange?: (timeMs: number | null) => void;
    replay: PlayablePerformanceReplay;
  }) => (
    <div data-auto-start={autoStart ? 'true' : 'false'} data-testid="performance-replay-player">
      <button type="button" onClick={() => onReplayTimeChange?.(120)}>
        {replay.kind}
      </button>
      {actions}
    </div>
  ),
}));

vi.mock('@/lib/practice/performance-playhead-controller', () => ({
  PerformancePlayheadController: vi.fn(function PerformancePlayheadController() {
    return playheadMocks;
  }),
}));

vi.mock('@/components/loading', () => ({
  PreviewLoading: ({ label }: { label: string }) => <div>{label}</div>,
  ResourceLoading: ({ label }: { label: string }) => <div>{label}</div>,
}));

vi.mock('@/components/states', () => ({
  EmptyState: ({ title }: { title: ReactNode }) => <div>{title}</div>,
  SectionErrorState: ({
    description,
    title,
  }: {
    description: ReactNode;
    title?: ReactNode;
  }) => (
    <section>
      {title ? <h2>{title}</h2> : null}
      <div>{description}</div>
    </section>
  ),
}));

vi.mock('@/components/score-preview/verovio-score-viewer', () => ({
  VerovioScoreViewer: ({
    onRendered,
  }: {
    onRendered?: (_adapter: unknown, container: HTMLDivElement) => void;
  }) => (
    <div
      data-testid="summary-score-viewer"
      ref={(node) => {
        if (node && node.dataset.rendered !== 'true') {
          node.dataset.rendered = 'true';
          onRendered?.(null, node);
        }
      }}
    >
      <span data-id="n1" />
      <span data-id="n2" />
      <span data-id="n3" />
      <span data-id="n4" />
    </div>
  ),
}));

vi.mock('@/hooks/practice/use-practice-ready-score-content', () => ({
  usePracticeReadyScoreContent: (scoreId: string, revisionId?: string | null) => {
    practiceContentMocks.readyContentArgs.push([scoreId, revisionId]);
    return {
      data: { data: { content: '<score-partwise />' } },
      isLoading: false,
    };
  },
}));

function session(
  overrides: Partial<PracticeSessionDetailRead> = {}
): PracticeSessionDetailRead {
  return {
    access_origin: 'OWNER',
    channels: 1,
    evaluation_profile: 'PERFORMANCE',
    finished_at: null,
    frame_format: 'pcm_s16le',
    input_source: 'MIDI',
    last_beat_position: null,
    last_confidence: null,
    performance_report_availability: {
      evaluation_available: true,
      saved_replay_available: false,
    },
    progression_mode: 'CONTINUOUS',
    realtime_guidance: 'STATUS_ONLY',
    revision_id: 'revision-from-session',
    sample_rate: 16000,
    score_id: 'score-1',
    session_id: 'session-1',
    started_at: null,
    state: 'FINISHED',
    summary_status: 'READY',
    ...overrides,
  } as PracticeSessionDetailRead;
}

const midiPerformanceSummaryPayload: PracticeSessionSummaryPayloadRead = {
  problem_measures: [
    {
      attempt_count: 1,
      average_confidence: 1,
      completed_target_count: 0,
      incomplete_target_count: 1,
      interrupted_attempt_count: 0,
      measure_number: '1',
      mismatch_attempt_count: 1,
      partial_attempt_count: 0,
      scorable_attempt_count: 1,
      skipped_attempt_count: 0,
      target_count: 1,
    },
  ],
  metrics: {
    confirmed_correct_strike_targets: 2,
    evaluation_profile: 'PERFORMANCE',
    expected_outcome_count: 3,
    extra_pitch_count: 1,
    input_source: 'MIDI',
    matched_expected_groups: 1,
    mismatched_expected_groups: 1,
    missing_strike_targets: 1,
    not_observed_expected_groups: 1,
    problem_measure_count: 1,
  },
  targets: [
    {
      attempt_count: 1,
      completed: true,
      completion_status: 'completed',
      confirmed_correct_render_note_ids: ['n1'],
      confirmed_error_render_note_ids: [],
      expected_group_id: 'entry-1',
      interrupted_attempt_count: 0,
      last_confidence: 1,
      last_result: 'MATCH',
      matched_attempt_count: 1,
      measure_numbers: ['1'],
      mismatch_attempt_count: 0,
      missing_pitches: [],
      partial_attempt_count: 0,
      render_note_ids: ['n1'],
      scorable_attempt_count: 1,
      skipped_attempt_count: 0,
      unexpected_pitches: [],
    },
    {
      attempt_count: 1,
      completed: false,
      completion_status: 'incomplete',
      confirmed_correct_render_note_ids: ['n2'],
      confirmed_error_render_note_ids: ['n3'],
      expected_group_id: 'entry-2',
      interrupted_attempt_count: 0,
      last_confidence: 1,
      last_result: 'MISMATCH',
      matched_attempt_count: 0,
      measure_numbers: ['1'],
      mismatch_attempt_count: 1,
      missing_pitches: ['G4'],
      partial_attempt_count: 0,
      render_note_ids: ['n2', 'n3'],
      scorable_attempt_count: 1,
      skipped_attempt_count: 0,
      unexpected_pitches: ['F4'],
    },
    {
      attempt_count: 1,
      completed: false,
      completion_status: 'incomplete',
      confirmed_correct_render_note_ids: [],
      confirmed_error_render_note_ids: [],
      expected_group_id: 'entry-3',
      interrupted_attempt_count: 0,
      last_confidence: 0,
      last_result: 'NOT_OBSERVED',
      matched_attempt_count: 0,
      measure_numbers: ['2'],
      mismatch_attempt_count: 0,
      missing_pitches: [],
      partial_attempt_count: 0,
      render_note_ids: ['n4'],
      scorable_attempt_count: 0,
      skipped_attempt_count: 0,
      unexpected_pitches: [],
    },
  ],
};

function summaryRead(
  payload: PracticeSessionSummaryPayloadRead | null
): PracticeSessionResultSummaryRead {
  return {
    performance_timeline: {
      scope_start_beat: 0,
      scope_terminal_beat: 4,
      segments: [
        {
          end_beat: 4,
          end_performance_time_ms: 1000,
          start_beat: 0,
          start_performance_time_ms: 0,
        },
      ],
    },
    session_id: 'session-1',
    summary_payload: payload,
    summary_status: payload ? 'READY' : 'FAILED',
  };
}

function savedArtifact(
  overrides: Partial<SavedPracticeReplayArtifactRead> = {}
): SavedPracticeReplayArtifactRead {
  return {
    artifact_id: 'artifact-1',
    byte_size: 128,
    checksum_sha256: 'checksum',
    content_type: 'application/vnd.noteverse.replay+json',
    created_at: '2026-09-01T00:00:00Z',
    duration_ms: 360,
    format_version: 1,
    input_source: 'MIDI',
    kind: 'MIDI_EVENTS',
    session_id: 'session-1',
    timebase_version: 1,
    ...overrides,
  };
}

function localReplay(): PlayablePerformanceReplay {
  return {
    durationMs: 360,
    events: [
      { event_type: 'note_on', note_number: 60, timestamp_ms: 120, velocity: 96 },
      { event_type: 'note_off', note_number: 60, timestamp_ms: 360, velocity: 0 },
    ],
    kind: 'MIDI_EVENTS',
    timebase: { speedRatio: 1, version: 1 },
  };
}

function renderPage() {
  return render(<PracticeSummaryPage />);
}

describe('PracticeSummaryPage', () => {
  beforeEach(() => {
    navigationMocks.back.mockReset();
    navigationMocks.scoreId = 'score-1';
    navigationMocks.sessionId = 'session-1';
    apiMocks.getPracticeSession.mockReset();
    apiMocks.getPracticeSessionSummary.mockReset();
    apiMocks.listPracticeReplayArtifacts.mockReset();
    apiMocks.getPracticeReplayArtifactPlaybackUrl.mockReset();
    apiMocks.authorizePracticeReplayUpload.mockReset();
    apiMocks.uploadPracticeReplayObject.mockReset();
    apiMocks.finalizePracticeReplayArtifact.mockReset();
    apiMocks.getPracticeSession.mockResolvedValue({ data: session() });
    apiMocks.getPracticeSessionSummary.mockResolvedValue({
      data: summaryRead(midiPerformanceSummaryPayload),
    });
    apiMocks.listPracticeReplayArtifacts.mockResolvedValue({ data: [] });
    apiMocks.authorizePracticeReplayUpload.mockResolvedValue({
      data: {
        artifact_id: 'artifact-1',
        byte_size: 128,
        checksum_sha256: 'checksum',
        content_type: 'application/vnd.noteverse.replay+json',
        duration_ms: 360,
        format_version: 1,
        kind: 'MIDI_EVENTS',
        timebase_version: 1,
        upload_headers: {
          'content-type': 'application/vnd.noteverse.replay+json',
          'x-amz-meta-sha256': 'checksum',
        },
        upload_method: 'PUT',
        upload_url: 'https://storage.example/replay',
      },
    });
    apiMocks.uploadPracticeReplayObject.mockResolvedValue(undefined);
    apiMocks.finalizePracticeReplayArtifact.mockResolvedValue({ data: savedArtifact() });
    localReplayStoreMocks.readPlayablePerformanceReplay.mockReset();
    localReplayStoreMocks.readPlayablePerformanceReplay.mockReturnValue(null);
    playheadMocks.applyPerformanceTime.mockReset();
    playheadMocks.clear.mockReset();
    practiceContentMocks.readyContentArgs = [];
    observabilityMocks.reportUnexpectedClientError.mockReset();
    toastMocks.toast.mockReset();
    vi.restoreAllMocks();
  });

  it('renders the performance report as a single report surface', async () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Performance Summary' })).toBeInTheDocument();
    expect(await screen.findByText('Annotated score')).toBeInTheDocument();
    expect(await screen.findByText('Measures needing attention')).toBeInTheDocument();
    expect(await screen.findByText('Correct strikes')).toBeInTheDocument();
    expect(screen.getByText('Missing strikes')).toBeInTheDocument();
    expect(screen.getAllByText('Extra playing')).toHaveLength(2);
    expect(screen.queryByText('Performance session completed.')).not.toBeInTheDocument();
    expect(screen.queryByText('Analysis unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Learning Summary')).not.toBeInTheDocument();
    expect(apiMocks.getPracticeSessionSummary).toHaveBeenCalledWith('session-1');
    expect(practiceContentMocks.readyContentArgs).toContainEqual([
      'score-1',
      'revision-from-session',
    ]);
  });

  it('projects confirmed performance evidence onto score noteheads', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n1"]'))
        .toHaveClass('practice-summary-note-confirmed-correct');
      expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n2"]'))
        .toHaveClass('practice-summary-note-confirmed-correct');
      expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n3"]'))
        .toHaveClass('practice-summary-note-confirmed-error');
      expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n4"]'))
        .not.toHaveClass('practice-summary-note-confirmed-error');
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Focus' }));
    expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n1"]'))
      .toHaveClass('practice-summary-note-focused');
  });

  it('does not project evaluation UI when report evaluation is unavailable', async () => {
    apiMocks.getPracticeSession.mockResolvedValue({
      data: session({
        performance_report_availability: {
          evaluation_available: false,
          saved_replay_available: false,
        },
      }),
    });

    renderPage();

    await screen.findByText('Annotated score');
    expect(screen.queryByText('Measures needing attention')).not.toBeInTheDocument();
    expect(screen.queryByText('Correct strikes')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n1"]'))
        .not.toHaveClass('practice-summary-note-confirmed-correct');
      expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n3"]'))
        .not.toHaveClass('practice-summary-note-confirmed-error');
    });
  });

  it('rejects non-performance sessions instead of rendering a learning report variant', async () => {
    apiMocks.getPracticeSession.mockResolvedValue({
      data: session({
        evaluation_profile: 'LEARNING',
        progression_mode: 'WAIT_FOR_NOTE',
        realtime_guidance: 'GUIDED',
      }),
    });

    renderPage();

    expect(
      await screen.findByText('This practice session does not have a performance report.')
    ).toBeInTheDocument();
    expect(apiMocks.getPracticeSessionSummary).not.toHaveBeenCalled();
    expect(screen.queryByText('Annotated score')).not.toBeInTheDocument();
  });

  it('shows the immediate local replay and removes save after saving', async () => {
    localReplayStoreMocks.readPlayablePerformanceReplay.mockReturnValue(localReplay());

    renderPage();

    expect(await screen.findByTestId('performance-replay-player')).toHaveTextContent(
      'MIDI_EVENTS'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Performance' }));

    await waitFor(() => expect(apiMocks.finalizePracticeReplayArtifact).toHaveBeenCalledTimes(1));
    expect(apiMocks.authorizePracticeReplayUpload).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        content_type: 'application/vnd.noteverse.replay+json',
        duration_ms: 360,
        format_version: 1,
        kind: 'MIDI_EVENTS',
        timebase_version: 1,
      })
    );
    expect(screen.queryByRole('button', { name: 'Save Performance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('loads saved replay only after the user asks to replay it', async () => {
    apiMocks.listPracticeReplayArtifacts.mockResolvedValue({ data: [savedArtifact()] });
    apiMocks.getPracticeReplayArtifactPlaybackUrl.mockResolvedValue({
      data: {
        artifact_id: 'artifact-1',
        content_type: 'application/vnd.noteverse.replay+json',
        duration_ms: 360,
        kind: 'MIDI_EVENTS',
        playback_url: 'https://storage.example/replay.json',
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({
        durationMs: 360,
        events: [
          { event_type: 'note_on', note_number: 60, timestamp_ms: 120, velocity: 96 },
        ],
        formatVersion: 1,
        speedRatio: 1,
        timebaseVersion: 1,
      }),
      ok: true,
    } as Response);

    renderPage();

    expect(await screen.findByRole('button', { name: 'Replay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('performance-replay-player')).not.toBeInTheDocument();
    expect(apiMocks.getPracticeReplayArtifactPlaybackUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));

    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();

    expect(await screen.findByTestId('performance-replay-player')).toHaveAttribute(
      'data-auto-start',
      'true'
    );
    expect(apiMocks.getPracticeReplayArtifactPlaybackUrl).toHaveBeenCalledWith(
      'session-1',
      'artifact-1'
    );
  });

  it('does not render an empty problem-measures card', async () => {
    apiMocks.getPracticeSessionSummary.mockResolvedValue({
      data: summaryRead({
        ...midiPerformanceSummaryPayload,
        problem_measures: [],
      }),
    });

    renderPage();

    await screen.findByText('Annotated score');
    expect(screen.queryByText('Measures needing attention')).not.toBeInTheDocument();
  });

  it('shows a route error without calling summary APIs when the session is missing', async () => {
    navigationMocks.sessionId = null;

    renderPage();

    expect(
      await screen.findByText('This practice summary is missing a practice session.')
    ).toBeInTheDocument();
    expect(apiMocks.getPracticeSession).not.toHaveBeenCalled();
    expect(apiMocks.getPracticeSessionSummary).not.toHaveBeenCalled();
  });
});
