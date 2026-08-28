// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PracticeSummaryPage from './page';
import type { PracticeSessionSummaryPayloadRead, PracticeSessionResultSummaryRead } from '@/generated/practice-api';

const navigationMocks = vi.hoisted(() => ({
  back: vi.fn(),
  push: vi.fn(),
  scoreId: 'score-1',
  sessionId: 'session-1' as string | null,
}));

const apiMocks = vi.hoisted(() => ({
  getPracticeSessionSummary: vi.fn(),
  getPracticeSession: vi.fn(),
}));

const practiceContentMocks = vi.hoisted(() => ({
  readyContentArgs: [] as Array<[string, string | null | undefined]>,
}));

const observabilityMocks = vi.hoisted(() => ({
  reportUnexpectedClientError: vi.fn(),
}));

const translationMocks = vi.hoisted(() => {
  const practice: Record<string, string> = {
    analysisFailedDesc: 'An error occurred while generating the Practice summary. Please try again later.',
    analysisFailedTitle: 'Analysis Failed',
    attempts: 'Attempts',
    attempt: 'Attempt',
    attemptsEmpty: 'No resolved attempts were recorded for this session.',
    backToPractice: 'Back to Practice',
    completionStatus: 'Status',
    confidence: 'Confidence',
    'attemptCompletion.COMPLETED': 'Completed',
    'attemptCompletion.INTERRUPTED': 'Interrupted',
    'attemptResult.MATCH': 'Matched',
    'attemptResult.MISMATCH': 'Mismatch',
    'attemptResult.PARTIAL': 'Partial',
    loadingSummary: 'Loading Practice summary...',
    loadingSummaryScore: 'Loading score annotations...',
    metrics: 'Metrics',
    learningDifficultMeasures: 'Measures to review',
    learningDifficultMeasuresEmpty: 'No difficult learning positions were identified in this summary.',
    performanceProblemMeasures: 'Problem measures',
    performanceProblemMeasuresEmpty: 'No performance problem measures were identified in this summary.',
    sectionMeasuresToReview: 'Section targets to review',
    sectionMeasuresEmpty: 'No difficult positions were identified in this section.',
    focusMeasure: 'Focus',
    summaryMissingSession: 'This Practice summary is missing a practice session.',
    summaryInvalidSession: 'This Practice summary does not belong to the current score.',
    learningSummarySubtitle: 'Review how this step-by-step practice went and where to revisit next.',
    learningSummaryTitle: 'Learning Summary',
    performanceSummarySubtitle: 'Review this full performance take, including accuracy, continuity, and confidence.',
    performanceSummaryTitle: 'Performance summary',
    sectionSummarySubtitle: 'Review this selected practice range before returning to the full score.',
    sectionSummaryTitle: 'Section Summary',
    recommendations: 'Recommendations',
    learningRecommendationsEmpty: 'No learning recommendations are available for this summary.',
    performanceRecommendationsEmpty: 'No performance recommendations are available for this summary.',
    sectionRecommendationsEmpty: 'No section-specific recommendations are available.',
    learningAccuracy: 'First-pass accuracy',
    learningCompletion: 'Target completion',
    learningCoverage: 'Learning coverage',
    performanceAccuracy: 'Accuracy',
    performanceCompletion: 'Performance completion',
    performanceCoverage: 'Analysis coverage',
    summaryInterruptedCount: '{count} interrupted attempts',
    summaryScorableAttempts: '{count} scorable attempts',
    summaryTargetCount: '{completed} of {total} targets completed',
    scoreAnnotations: 'Annotated score',
    scoreAnnotationsEmpty: 'No specific score positions need annotation.',
    scoreAnnotationsUnavailable: 'Score annotations are unavailable for this summary.',
    measureNumber: 'Measure {number}',
    measureTargets: '{completed} of {total} targets completed',
    reviewReasonIncomplete: 'Unresolved target in this measure',
    reviewReasonNeedsAttention: 'Review this measure',
    reviewReasonPartialNotes: 'Partial notes were recorded here',
    reviewReasonWrongNotes: 'Wrong notes were recorded here',
    mismatches: 'Wrong',
    partials: 'Partial',
    'resolutionReasonValue.connection_closed': 'Connection closed',
    'resolutionReasonValue.entry_mismatch': 'Wrong note',
    'resolutionReasonValue.stable_match': 'Stable match',
    resolutionReason: 'Resolution',
    result: 'Result',
    summary: 'Summary',
    target: 'Target',
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
    push: navigationMocks.push,
  }),
  useSearchParams: () => ({
    get: (key: string) => (key === 'sessionId' ? navigationMocks.sessionId : null),
  }),
}));

vi.mock('@/lib/api', () => ({
  practiceApi: {
    getPracticeSessionSummary: (...args: unknown[]) => apiMocks.getPracticeSessionSummary(...args),
    getPracticeSession: (...args: unknown[]) => apiMocks.getPracticeSession(...args),
  },
}));

vi.mock('@/lib/observability', () => ({
  reportUnexpectedClientError: (...args: unknown[]) =>
    observabilityMocks.reportUnexpectedClientError(...args),
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

const summaryPayload: PracticeSessionSummaryPayloadRead = {
  summary: 'You completed one target and should revisit the ending.',
  recommendations: ['Review the second measure slowly.'],
  metrics: {
    attempt_count: 3,
    completed_targets: 1,
    interrupted_attempts: 1,
    match_rate: 0.5,
    scorable_attempt_count: 2,
    scorable_target_completion_rate: 1,
    scorable_target_count: 1,
    scoring_coverage: 0.667,
    scoring_policy_version: 'practice-summary-scoring-v1',
    target_completion_rate: 0.5,
    target_count: 2,
  },
  attempts: [
    {
      action: 'advance',
      attempt_index: 1,
      attempt_uid: 'attempt-1',
      beat_position: 1,
      completion_status: 'COMPLETED',
      confidence: 0.91,
      correctness_scope: 'entry',
      evidence_profile: 'deterministic',
      input_source: 'MIDI',
      measure_numbers: ['1'],
      render_note_ids: ['n1'],
      resolution_reason: 'stable_match',
      result: 'MATCH',
      scoring_included: true,
    },
    {
      action: 'hold',
      attempt_index: 2,
      attempt_uid: 'attempt-2',
      beat_position: 2,
      completion_status: 'COMPLETED',
      confidence: 0.2,
      correctness_scope: 'entry',
      event_id: 'event-2',
      evidence_profile: 'deterministic',
      input_source: 'MIDI',
      measure_numbers: ['2'],
      render_note_ids: [],
      resolution_reason: 'entry_mismatch',
      result: 'MISMATCH',
      scoring_included: true,
    },
    {
      action: 'wait',
      attempt_index: 3,
      attempt_uid: 'attempt-3',
      beat_position: 3,
      completion_status: 'INTERRUPTED',
      confidence: 0.4,
      correctness_scope: 'entry',
      evidence_profile: 'deterministic',
      expected_group_id: 'entry-3',
      input_source: 'MIDI',
      measure_numbers: ['2'],
      render_note_ids: ['n3'],
      resolution_reason: 'connection_closed',
      result: 'PARTIAL',
      scoring_included: false,
    },
  ],
  targets: [
    {
      expected_group_id: 'entry-1',
      measure_numbers: ['1'],
      render_note_ids: ['n1'],
      attempt_count: 2,
      scorable_attempt_count: 2,
      interrupted_attempt_count: 0,
      matched_attempt_count: 1,
      partial_attempt_count: 1,
      mismatch_attempt_count: 0,
      completed: true,
      completion_status: 'completed',
      last_result: 'MATCH',
      last_confidence: 0.91,
    },
    {
      expected_group_id: 'entry-2',
      measure_numbers: ['2'],
      render_note_ids: ['n2'],
      attempt_count: 2,
      scorable_attempt_count: 1,
      interrupted_attempt_count: 1,
      matched_attempt_count: 0,
      partial_attempt_count: 1,
      mismatch_attempt_count: 1,
      completed: false,
      completion_status: 'incomplete',
      last_result: 'PARTIAL',
      last_confidence: 0.4,
    },
  ],
  difficult_measures: [
    {
      measure_number: '2',
      target_count: 1,
      completed_target_count: 0,
      incomplete_target_count: 1,
      attempt_count: 2,
      scorable_attempt_count: 1,
      interrupted_attempt_count: 1,
      partial_attempt_count: 1,
      mismatch_attempt_count: 1,
      average_confidence: 0.4,
      difficulty_score: 6.75,
    },
  ],
};

function summaryRead(payload: PracticeSessionSummaryPayloadRead | null): PracticeSessionResultSummaryRead {
  return {
    summary_payload: payload,
    summary_status: payload ? 'READY' : 'FAILED',
    session_id: 'session-1',
  };
}

function renderPage() {
  return render(<PracticeSummaryPage />);
}

describe('PracticeSummaryPage', () => {
  beforeEach(() => {
    navigationMocks.back.mockReset();
    navigationMocks.push.mockReset();
    navigationMocks.scoreId = 'score-1';
    navigationMocks.sessionId = 'session-1';
    apiMocks.getPracticeSessionSummary.mockReset();
    apiMocks.getPracticeSession.mockReset();
    practiceContentMocks.readyContentArgs = [];
    observabilityMocks.reportUnexpectedClientError.mockReset();
    apiMocks.getPracticeSession.mockResolvedValue({
      data: {
        session_id: 'session-1',
        score_id: 'score-1',
        revision_id: 'revision-from-session',
        access_origin: 'OWNER',
        state: 'FINISHED',
        progression_mode: 'WAIT_FOR_NOTE',
        realtime_guidance: 'GUIDED',
        evaluation_profile: 'LEARNING',
        input_source: 'MIDI',
        sample_rate: 16000,
        channels: 1,
        frame_format: 'pcm_s16le',
        started_at: null,
        finished_at: null,
        last_beat_position: null,
        last_confidence: null,
        summary_status: 'READY',
      },
    });
  });

  it('renders summary metrics, recommendations, and explicit attempt resolution semantics', async () => {
    apiMocks.getPracticeSessionSummary.mockResolvedValue({ data: summaryRead(summaryPayload) });

    renderPage();

    expect(screen.getByRole('heading', { name: 'Learning Summary' })).toBeInTheDocument();
    expect(await screen.findByText('You completed one target and should revisit the ending.')).toBeInTheDocument();
    expect(screen.getByText('Review the second measure slowly.')).toBeInTheDocument();
    expect(screen.getByText('Measures to review')).toBeInTheDocument();
    expect(screen.getByText('Annotated score')).toBeInTheDocument();
    expect(screen.getByText('Measure 2')).toBeInTheDocument();
    expect(screen.getByText('Unresolved target in this measure')).toBeInTheDocument();
    expect(screen.getByText('Focus')).toBeInTheDocument();
    expect(screen.getAllByText('50%')).toHaveLength(2);
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('1 of 2 targets completed')).toBeInTheDocument();
    expect(screen.getByText('2 scorable attempts')).toBeInTheDocument();
    expect(screen.getByText('1 interrupted attempts')).toBeInTheDocument();
    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('Mismatch')).toBeInTheDocument();
    expect(screen.getAllByText('Partial').length).toBeGreaterThan(0);
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(screen.getByText('Connection closed')).toBeInTheDocument();
    expect(screen.getByText('practice-summary-scoring-v1')).toBeInTheDocument();
    expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n1"]')).toHaveClass(
      'practice-summary-note-review'
    );
    expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n2"]')).toHaveClass(
      'practice-summary-note-problem'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(screen.getByTestId('summary-score-viewer').querySelector('[data-id="n2"]')).toHaveClass(
      'practice-summary-note-focused'
    );
    expect(screen.queryByRole('link', { name: /practice/i })).not.toBeInTheDocument();
    expect(apiMocks.getPracticeSession).toHaveBeenCalledWith('session-1');
    expect(practiceContentMocks.readyContentArgs).toContainEqual([
      'score-1',
      'revision-from-session',
    ]);
    expect(practiceContentMocks.readyContentArgs).not.toContainEqual([
      'score-1',
      'revision-from-head',
    ]);
    expect(apiMocks.getPracticeSessionSummary).toHaveBeenCalledWith('session-1');
  });

  it('shows a missing-session error without calling the summary APIs', async () => {
    navigationMocks.sessionId = null;

    renderPage();

    expect(await screen.findByText('This Practice summary is missing a practice session.')).toBeInTheDocument();
    expect(apiMocks.getPracticeSession).not.toHaveBeenCalled();
    expect(apiMocks.getPracticeSessionSummary).not.toHaveBeenCalled();
  });

  it('rejects a summary session that belongs to a different score route', async () => {
    apiMocks.getPracticeSession.mockResolvedValue({
      data: {
        session_id: 'session-1',
        score_id: 'other-score',
        revision_id: 'revision-from-session',
        access_origin: 'OWNER',
        state: 'FINISHED',
        progression_mode: 'WAIT_FOR_NOTE',
        realtime_guidance: 'GUIDED',
        evaluation_profile: 'LEARNING',
        input_source: 'MIDI',
        sample_rate: 16000,
        channels: 1,
        frame_format: 'pcm_s16le',
        started_at: null,
        finished_at: null,
        last_beat_position: null,
        last_confidence: null,
        summary_status: 'READY',
      },
    });

    renderPage();

    expect(
      await screen.findByText('This Practice summary does not belong to the current score.')
    ).toBeInTheDocument();
    expect(apiMocks.getPracticeSession).toHaveBeenCalledWith('session-1');
    expect(apiMocks.getPracticeSessionSummary).not.toHaveBeenCalled();
  });

  it('renders a stable empty-attempts state', async () => {
    apiMocks.getPracticeSessionSummary.mockResolvedValue({
      data: summaryRead({
        ...summaryPayload,
        attempts: [],
        difficult_measures: [],
        recommendations: [],
      }),
    });

    renderPage();

    expect(await screen.findByText('No resolved attempts were recorded for this session.')).toBeInTheDocument();
    expect(screen.getByText('No difficult learning positions were identified in this summary.')).toBeInTheDocument();
    expect(screen.getByText('No learning recommendations are available for this summary.')).toBeInTheDocument();
  });
});
