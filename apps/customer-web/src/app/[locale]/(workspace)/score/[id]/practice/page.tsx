'use client';

import { useLocale, useTranslations } from 'next-intl';
import { practiceApi } from '@/lib/api';
import { useScoreDetail } from '@/hooks/queries/use-score-queries';
import {
  PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
  type PracticeAlignmentUpdateMessage,
  type PracticePerformanceClockPayload,
  type PracticePerformanceTimelinePayload,
  type PracticeServerMessage,
} from '@/lib/practice/protocol';
import type {
  PracticeInputSource,
  PracticeSessionCompletionOutcomeRead,
  PracticeSessionDetailRead,
  PracticeSessionScope,
} from '@/generated/practice-api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { usePracticeAudioStream } from '@/hooks/practice/use-practice-audio-stream';
import { usePracticeMidiStream, type PracticeMidiEvent } from '@/hooks/practice/use-practice-midi-stream';
import { usePracticeRecording } from '@/hooks/practice/use-practice-recording';
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { usePracticeSession } from '@/hooks/practice/use-practice-session';
import { usePracticeSocket } from '@/hooks/practice/use-practice-socket';
import { usePracticeTargets } from '@/hooks/practice/use-practice-targets';
import { ClientOnly } from '@/components/client-only';
import { PracticeScoreViewer } from '@/components/practice/practice-score-viewer';
import { PracticeControls } from '@/components/practice/practice-controls';
import { PracticeCompletionDialog } from '@/components/practice/practice-completion-dialog';
import { PracticeSettingsPanel } from '@/components/practice/practice-settings-panel';
import { PracticeSessionStatus } from '@/components/practice/practice-session-status';
import { PracticeSkipControl } from '@/components/practice/practice-skip-control';
import { ResourceLoadError } from '@/components/states';
import { ResourceLoading } from '@/components/loading';
import { ScoreSurface } from '@/components/score/score-surface';
import { WorkspaceAccessDenied } from '@/components/score/workspace-access-denied';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { translateErrorCode, userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  PracticeConnectionStatus,
  PracticeStatus,
} from '@/lib/practice/practice-types';
import { resolvePracticeCompletionOutcome } from '@/lib/practice/completion-outcome';
import {
  buildMidiPerformanceReplay,
  createPerformanceReplayTimebase,
  type PlayablePerformanceReplay,
} from '@/lib/practice/performance-replay';
import {
  completedReportHandoffSessionId,
  shouldWaitForLocalReplayHandoff,
  type LocalReplayFinalizationState,
} from '@/lib/practice/report-handoff';
import { savePlayablePerformanceReplay } from '@/lib/practice/local-performance-replay-store';
import type { PracticeSessionMode } from '@/lib/practice/session-policy';
import {
  fullPiecePracticeRangeSelection,
  practiceTargetsInRangeSelection,
  practiceScopeFromRangeSelection,
  selectPracticeRangeTarget,
  selectedPracticeRangeSelection,
  targetByGroupId,
  targetForRenderNoteId,
  type PracticeRangeSelection,
} from '@/lib/practice/range-selection';

type PracticeInputHealth = Extract<
  PracticeServerMessage,
  { type: 'session.armed' }
>['payload']['input_health'];

type PracticeScopeSelection =
  | {
      kind: 'FULL_PIECE';
      revisionId: null;
      inputSource: null;
      scope: null;
    }
  | {
      kind: 'SELECTED_RANGE';
      revisionId: string | null;
      inputSource: PracticeInputSource;
      scope: PracticeSessionScope;
    };

const fullPieceScopeSelection: PracticeScopeSelection = {
  kind: 'FULL_PIECE',
  revisionId: null,
  inputSource: null,
  scope: null,
};

function hasSelectedRange(
  scopeSelection: PracticeScopeSelection
): scopeSelection is Extract<PracticeScopeSelection, { kind: 'SELECTED_RANGE' }> {
  return scopeSelection.kind === 'SELECTED_RANGE';
}

type SelectedRangePracticeRequest = Extract<
  PracticeScopeSelection,
  { kind: 'SELECTED_RANGE' }
>;

type SelectedRangeDisplay = {
  startMeasureLabel: string | null;
  endMeasureLabel: string | null;
};

type PracticeRangeSelectionVisual = {
  renderNoteIds: string[];
  startRenderNoteIds: string[];
  endRenderNoteIds: string[];
};

const emptyPracticeRangeSelectionVisual: PracticeRangeSelectionVisual = {
  renderNoteIds: [],
  startRenderNoteIds: [],
  endRenderNoteIds: [],
};

function selectedRangeDisplay(
  scope: PracticeSessionScope
): SelectedRangeDisplay {
  const startMeasureLabel = scope.start_measure_number ?? null;
  const endMeasureLabel = scope.end_measure_number ?? null;
  return {
    startMeasureLabel,
    endMeasureLabel:
      endMeasureLabel &&
      endMeasureLabel !== startMeasureLabel
        ? endMeasureLabel
        : null,
  };
}

function practiceScopeLabel(scope: PracticeSessionScope): string {
  const display = selectedRangeDisplay(scope);
  if (!display.startMeasureLabel) {
    return 'n/a';
  }
  if (!display.endMeasureLabel) {
    return display.startMeasureLabel;
  }
  return `${display.startMeasureLabel}-${display.endMeasureLabel}`;
}

function selectedRangeLabel(range: SelectedRangePracticeRequest): string {
  return practiceScopeLabel(range.scope);
}

function renderNoteIdsForTargetGroup(
  targets: ReturnType<typeof practiceTargetsInRangeSelection>,
  groupId: string | null | undefined
) {
  if (!groupId) {
    return [];
  }
  return targetByGroupId(targets, groupId)?.render_note_ids ?? [];
}

function practiceRangeSelectionVisual(
  selection: PracticeRangeSelection,
  targets: ReturnType<typeof practiceTargetsInRangeSelection>
): PracticeRangeSelectionVisual {
  if (selection.kind === 'FULL_PIECE' || !selection.startGroupId) {
    return emptyPracticeRangeSelectionVisual;
  }

  const startRenderNoteIds = renderNoteIdsForTargetGroup(targets, selection.startGroupId);
  if (!selection.endGroupId) {
    return {
      renderNoteIds: startRenderNoteIds,
      startRenderNoteIds,
      endRenderNoteIds: [],
    };
  }

  return {
    renderNoteIds: practiceTargetsInRangeSelection(selection, targets).flatMap(
      (target) => target.render_note_ids ?? []
    ),
    startRenderNoteIds,
    endRenderNoteIds: renderNoteIdsForTargetGroup(targets, selection.endGroupId),
  };
}

function practiceInputSourceFromQuery(value: string | null): PracticeInputSource {
  return value === 'MIDI' ? 'MIDI' : 'MICROPHONE';
}

function practiceScopeSelectionFromSearchParams(
  searchParams: ReturnType<typeof useSearchParams>
): PracticeScopeSelection {
  const startExpectedGroupId = searchParams.get('practiceStartGroup');
  if (!startExpectedGroupId) {
    return fullPieceScopeSelection;
  }
  return {
    kind: 'SELECTED_RANGE',
    revisionId: searchParams.get('practiceRevisionId'),
    inputSource: practiceInputSourceFromQuery(searchParams.get('practiceInputSource')),
    scope: {
      start_expected_group_id: startExpectedGroupId,
      end_expected_group_id: searchParams.get('practiceEndGroup'),
      start_measure_number: searchParams.get('practiceStartMeasure'),
      end_measure_number: searchParams.get('practiceEndMeasure'),
    },
  };
}

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id } = resolvedParams;
  const t = useTranslations('practice');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const practiceScopeSelection = useMemo(
    () => practiceScopeSelectionFromSearchParams(searchParams),
    [searchParams]
  );
  const selectedRangePractice = hasSelectedRange(practiceScopeSelection)
    ? practiceScopeSelection
    : null;
  const { toast } = useToast();

  const [practiceStatus, setPracticeStatus] = useState<PracticeStatus>('idle');
  const [connectionStatus, setConnectionStatus] =
    useState<PracticeConnectionStatus>('disconnected');
  const [isLoading, setIsLoading] = useState(false);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [practiceTime, setPracticeTime] = useState(0);
  const [practiceClockStarted, setPracticeClockStarted] = useState(false);
  const [alignment, setAlignment] = useState<PracticeAlignmentUpdateMessage['payload'] | null>(null);
  const [performanceClockSync, setPerformanceClockSync] =
    useState<PracticePerformanceClockPayload | null>(null);
  const [performanceClockSyncReceivedAtMs, setPerformanceClockSyncReceivedAtMs] =
    useState<number | null>(null);
  const [performanceTimeline, setPerformanceTimeline] =
    useState<PracticePerformanceTimelinePayload | null>(null);
  const [selectedPracticeMode, setSelectedPracticeMode] =
    useState<PracticeSessionMode>('STEP_BY_STEP');
  const [activeSessionMode, setActiveSessionMode] = useState<PracticeSessionMode>('STEP_BY_STEP');
  const activeSessionModeRef = useRef<PracticeSessionMode>('STEP_BY_STEP');
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);
  const [completedSessionId, setCompletedSessionId] = useState<string | null>(null);
  const [completedOutcome, setCompletedOutcome] =
    useState<PracticeSessionCompletionOutcomeRead | null>(null);
  const [completedLocalMidiReplay, setCompletedLocalMidiReplay] =
    useState<PlayablePerformanceReplay | null>(null);
  const [localReplayFinalizationState, setLocalReplayFinalizationState] =
    useState<LocalReplayFinalizationState>({ status: 'not_expected' });
  const [pendingReportHandoffSessionId, setPendingReportHandoffSessionId] =
    useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [rangeSelection, setRangeSelection] = useState<PracticeRangeSelection>(
    fullPiecePracticeRangeSelection
  );
  const [practiceInputSource, setPracticeInputSource] = useState<PracticeInputSource>(
    selectedRangePractice?.inputSource ?? 'MICROPHONE'
  );
  const scoreQuery = useScoreDetail(id);
  const scoreCapabilities = scoreQuery.data?.data?.capabilities;
  const canEnterPractice = scoreCapabilities?.can_practice === true;
  const selectedRevisionId =
    selectedRangePractice?.revisionId ?? scoreQuery.data?.data?.head_revision_id ?? undefined;
  const revisionQuery = usePracticeReadyScoreContent(
    id,
    selectedRevisionId,
    canEnterPractice && Boolean(selectedRevisionId)
  );
  const xmlContent = revisionQuery.data?.data?.content;
  const revisionId = selectedRevisionId;
  const practiceTargetsQuery = usePracticeTargets(
    id,
    revisionId,
    canEnterPractice && Boolean(revisionId)
  );
  const practiceTargets = useMemo(
    () => practiceTargetsQuery.data?.data?.targets ?? [],
    [practiceTargetsQuery.data]
  );
  const selectedRangeScope = useMemo(
    () => practiceScopeFromRangeSelection(rangeSelection, practiceTargets),
    [practiceTargets, rangeSelection]
  );
  const activePracticeScope = selectedRangePractice?.scope ?? selectedRangeScope;
  const hasManualRangeSelection =
    !selectedRangePractice && rangeSelection.kind === 'SELECTED_RANGE';
  const isManualRangeSelectionPending =
    hasManualRangeSelection && !selectedRangeScope;
  const isLoadingXml = scoreQuery.isLoading || revisionQuery.isLoading;
  const isResourceLoading =
    scoreQuery.isLoading || (Boolean(selectedRevisionId) && revisionQuery.isLoading);
  const loadError = scoreQuery.error ?? revisionQuery.error;
  const resourceMissingAfterLoad = !isResourceLoading && !loadError && (!revisionId || !xmlContent);
  const loadErrorDescription = loadError
    ? userFacingErrorMessage(errors, loadError, common('loadFailedDescription'))
    : resourceMissingAfterLoad
      ? common('loadFailedDescription')
      : null;
  const canPreparePractice =
    canEnterPractice &&
    Boolean(revisionId && xmlContent) &&
    !isResourceLoading &&
    !loadError &&
    !isManualRangeSelectionPending;

  const practiceStatusRef = useRef<PracticeStatus>('idle');
  const pausedPracticeStatusRef = useRef<'listening' | 'practicing'>('listening');
  const activeInputSourceRef = useRef<PracticeInputSource>(
    selectedRangePractice?.inputSource ?? 'MICROPHONE'
  );
  const runningPracticeScopeRef = useRef<PracticeSessionScope | null>(null);
  const finishRecoveryTimerRef = useRef<number | null>(null);
  const localMidiReplayEventsRef = useRef<PracticeMidiEvent[]>([]);
  const localReplayCaptureActiveRef = useRef(false);
  const performanceClockSyncRef = useRef<PracticePerformanceClockPayload | null>(null);
  const performanceSpeedRatioRef = useRef(1);
  const socket = usePracticeSocket({ onMessage: handleSocketMessage, onClose: handleSocketClose });
  const audioStream = usePracticeAudioStream(socket.sendBinary);
  const sendMidiEvent = useCallback((event: PracticeMidiEvent) => {
    if (
      activeSessionModeRef.current === 'CONTINUOUS_PLAY' &&
      activeInputSourceRef.current === 'MIDI' &&
      localReplayCaptureActiveRef.current &&
      (practiceStatusRef.current === 'listening' ||
        practiceStatusRef.current === 'practicing')
    ) {
      localMidiReplayEventsRef.current.push(event);
    }
    socket.sendJson({
      protocol_version: PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
      type: 'client.midi_event',
      payload: event,
    });
  }, [socket]);
  const handleMidiInputsDisconnected = useCallback(() => {
    if (
      activeInputSourceRef.current !== 'MIDI' ||
      !(
        practiceStatusRef.current === 'listening' ||
        practiceStatusRef.current === 'practicing' ||
        practiceStatusRef.current === 'paused'
      )
    ) {
      return;
    }
    practiceStatusRef.current = 'idle';
    setPracticeStatus('idle');
    setPracticeClockStarted(false);
    setConnectionStatus('disconnected');
    socket.close();
    toast({
      variant: 'destructive',
      title: t('midiDisconnectedTitle'),
      description: t('midiDisconnectedDesc'),
    });
  }, [socket, t, toast]);
  const midiStream = usePracticeMidiStream(sendMidiEvent, {
    onInputsDisconnected: handleMidiInputsDisconnected,
  });
  const recording = usePracticeRecording();
  const practiceSession = usePracticeSession({
    scoreId: id,
    revisionId,
    practiceMode: selectedPracticeMode,
    inputSource: practiceInputSource,
    practiceScope: activePracticeScope,
  });
  const performanceReplay = recording.audioReplay ?? completedLocalMidiReplay;
  const completionOutcome = completedOutcome
    ? resolvePracticeCompletionOutcome({
        completionOutcome: completedOutcome,
      })
    : null;
  const hasMicPermission = audioStream.hasMicPermission;
  const audioWorkletSupported = audioStream.isSupported;
  const selectedInputSupported =
    practiceInputSource === 'MIDI' ? midiStream.isSupported : audioWorkletSupported;
  const canSelectRange =
    !selectedRangePractice &&
    practiceStatus === 'idle' &&
    practiceTargets.length > 0 &&
    !practiceTargetsQuery.isLoading;
  const activePracticeScopeLabel = activePracticeScope ? practiceScopeLabel(activePracticeScope) : null;
  const rangeSelectionDescription = selectedRangePractice
    ? t('selectedSectionPracticeDesc', { range: selectedRangeLabel(selectedRangePractice) })
    : selectedRangeScope && activePracticeScopeLabel
      ? t('rangeSelectionReady', { range: activePracticeScopeLabel })
      : isManualRangeSelectionPending && rangeSelection.startGroupId
        ? t('rangeSelectionPromptEnd')
        : isManualRangeSelectionPending
          ? t('rangeSelectionPromptStart')
          : null;
  const activeRangeSelectionForVisual = selectedRangePractice
    ? selectedPracticeRangeSelection(
        selectedRangePractice.scope.start_expected_group_id,
        selectedRangePractice.scope.end_expected_group_id
      )
    : rangeSelection;
  const activeRangeSelectionVisual = useMemo(
    () => practiceRangeSelectionVisual(activeRangeSelectionForVisual, practiceTargets),
    [activeRangeSelectionForVisual, practiceTargets]
  );
  const promptDisplayAnchor = useMemo(() => {
    if (!activePracticeScope) {
      return null;
    }
    const target = targetByGroupId(
      practiceTargets,
      activePracticeScope.start_expected_group_id
    );
    if (!target) {
      return null;
    }
    return {
      beat: target.onset_beat,
      group_id: target.group_id,
      render_note_ids: target.render_note_ids ?? [],
    };
  }, [activePracticeScope, practiceTargets]);
  const displayAlignment = useMemo<PracticeAlignmentUpdateMessage['payload'] | null>(() => {
    if (activeSessionMode !== 'STEP_BY_STEP') {
      return null;
    }
    if (alignment) {
      return alignment;
    }
    if (practiceStatus !== 'listening') {
      if (practiceStatus !== 'practicing' && practiceStatus !== 'paused') {
        return null;
      }
    }
    return {
      beat_position: promptDisplayAnchor?.beat ?? -1,
      confidence: 1,
      alignment_confidence: 1,
      audio_confidence: 1,
      continuity_confidence: 1,
      visual_confidence: 1,
      timestamp_ms: 0,
      scope_completed: false,
      completion_reason: null,
      audio_active: true,
      input_rms: 0,
      input_peak: 0,
      input_health: {
        available: true,
        level: 'good',
        noise: 'good',
        confidence: 1,
      },
      match_state: 'matched',
      feature_confidence: 1,
      beat_delta: null,
      stream_state: 'prompt',
      frame_class: 'tonal',
      gate_reason: 'first_note_prompt',
      queue_decision: 'prompt',
      tonal_signal: true,
      onset_signal: false,
      spectral_flatness: 0,
      peak_prominence: 0,
      spectral_flux: 0,
      alignment_state: 'prompt',
      continuity_state: 'initial',
      beat_velocity: null,
      validation_confidence: 1,
      input_weight: 1,
      input_policy_confidence: 1,
      decision: {
        action: 'advance',
        reason: 'stable_match',
        experience_state: 'waiting_for_input',
        display_anchor: promptDisplayAnchor,
        confidence_summary: {
          visual: 1,
          alignment: 1,
          audio: 1,
          continuity: 1,
          validation: 1,
          input_policy: 1,
        },
      },
    };
  }, [activeSessionMode, alignment, practiceStatus, promptDisplayAnchor]);

  const clearFinishRecoveryTimer = useCallback(() => {
    if (finishRecoveryTimerRef.current) {
      window.clearTimeout(finishRecoveryTimerRef.current);
      finishRecoveryTimerRef.current = null;
    }
  }, []);

  const updateActiveSessionMode = useCallback((mode: PracticeSessionMode) => {
    activeSessionModeRef.current = mode;
    setActiveSessionMode(mode);
  }, []);

  const clearPerformanceClockSync = useCallback(() => {
    performanceClockSyncRef.current = null;
    setPerformanceClockSync(null);
    setPerformanceClockSyncReceivedAtMs(null);
  }, []);

  const updatePerformanceClockSync = useCallback((sync: PracticePerformanceClockPayload) => {
    performanceClockSyncRef.current = sync;
    setPerformanceClockSync(sync);
    setPerformanceClockSyncReceivedAtMs(performance.now());
  }, []);

  const resetPracticeSessionDraft = useCallback(() => {
    clearFinishRecoveryTimer();
    practiceSession.clear();
    socket.close();
    setAlignment(null);
    clearPerformanceClockSync();
    setPerformanceTimeline(null);
    updateActiveSessionMode(selectedPracticeMode);
    setConnectionStatus('disconnected');
  }, [
    clearPerformanceClockSync,
    clearFinishRecoveryTimer,
    practiceSession,
    selectedPracticeMode,
    socket,
    updateActiveSessionMode,
  ]);

  const handleToggleRangeSelection = () => {
    if (selectedRangePractice || practiceStatusRef.current !== 'idle') {
      return;
    }
    if (hasManualRangeSelection) {
      resetPracticeSessionDraft();
      setRangeSelection(fullPiecePracticeRangeSelection);
      return;
    }
    if (practiceTargets.length === 0 || practiceTargetsQuery.isLoading) {
      toast({
        title: t('rangeSelectionUnavailable'),
      });
      return;
    }
    resetPracticeSessionDraft();
    setRangeSelection(selectedPracticeRangeSelection());
  };

  const handleRenderNoteClick = (renderNoteId: string) => {
    if (!isManualRangeSelectionPending || practiceStatusRef.current !== 'idle') {
      return;
    }
    const target = targetForRenderNoteId(practiceTargets, renderNoteId);
    if (!target) {
      return;
    }
    resetPracticeSessionDraft();
    const next = selectPracticeRangeTarget(rangeSelection, practiceTargets, target.group_id);
    setRangeSelection(next);
  };

  useEffect(() => {
    practiceStatusRef.current = practiceStatus;
  }, [practiceStatus]);

  useEffect(() => {
    if (practiceStatus === 'practicing') {
      setIsSettingsOpen(false);
    }
  }, [practiceStatus]);

  const updatePracticeStatus = (status: PracticeStatus) => {
    practiceStatusRef.current = status;
    setPracticeStatus(status);
  };

  const startLocalPerformanceCapture = useCallback(() => {
    if (
      activeSessionModeRef.current !== 'CONTINUOUS_PLAY' ||
      localReplayCaptureActiveRef.current
    ) {
      return;
    }
    localReplayCaptureActiveRef.current = true;
    const timebase = createPerformanceReplayTimebase(performanceSpeedRatioRef.current);
    if (activeInputSourceRef.current === 'MICROPHONE') {
      audioStream.setStreaming(true);
      recording.start(timebase);
      recording.resume();
      return;
    }
    if (activeInputSourceRef.current === 'MIDI') {
      midiStream.setStreaming(true);
    }
  }, [audioStream, midiStream, recording]);

  const pauseLocalPerformanceCapture = useCallback(() => {
    if (
      activeSessionModeRef.current !== 'CONTINUOUS_PLAY' ||
      !localReplayCaptureActiveRef.current
    ) {
      return;
    }
    localReplayCaptureActiveRef.current = false;
    if (activeInputSourceRef.current === 'MICROPHONE') {
      audioStream.setStreaming(false);
      recording.pause();
      return;
    }
    if (activeInputSourceRef.current === 'MIDI') {
      midiStream.setStreaming(false);
    }
  }, [audioStream, midiStream, recording]);

  const finishLocalPerformanceCapture = useCallback(() => {
    if (activeSessionModeRef.current !== 'CONTINUOUS_PLAY') {
      return;
    }
    localReplayCaptureActiveRef.current = false;
    if (activeInputSourceRef.current === 'MICROPHONE') {
      audioStream.setStreaming(false);
      recording.stop();
      return;
    }
    if (activeInputSourceRef.current === 'MIDI') {
      midiStream.setStreaming(false);
      setCompletedLocalMidiReplay(
        buildMidiPerformanceReplay(
          localMidiReplayEventsRef.current,
          createPerformanceReplayTimebase(performanceSpeedRatioRef.current)
        )
      );
    }
  }, [audioStream, midiStream, recording]);

  useEffect(() => clearFinishRecoveryTimer, [clearFinishRecoveryTimer]);

  useEffect(() => {
    if (!completedSessionId || !completedOutcome?.playback_expected) {
      return;
    }
    if (recording.finalizationStatus === 'failed') {
      setLocalReplayFinalizationState({ status: 'failed', sessionId: completedSessionId });
      return;
    }
    if (!performanceReplay) {
      return;
    }
    if (performanceReplay.kind === 'AUDIO_RECORDING' && performanceReplay.byteSize === 0) {
      setLocalReplayFinalizationState({ status: 'failed', sessionId: completedSessionId });
      return;
    }
    savePlayablePerformanceReplay(completedSessionId, performanceReplay);
    setLocalReplayFinalizationState({ status: 'ready', sessionId: completedSessionId });
  }, [
    completedOutcome?.playback_expected,
    completedSessionId,
    performanceReplay,
    recording.finalizationStatus,
  ]);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (
      practiceClockStarted &&
      (practiceStatus === 'listening' ||
        practiceStatus === 'practicing')
    ) {
      timer = setInterval(() => {
        setPracticeTime((prevTime) => prevTime + 1);
      }, 1000);
    }
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [practiceClockStarted, practiceStatus]);

  useEffect(() => {
    const canHeartbeat =
      socket.isOpen() &&
      (practiceStatus === 'listening' ||
        practiceStatus === 'practicing' ||
        practiceStatus === 'paused');

    if (!canHeartbeat) {
      socket.stopHeartbeat();
      return undefined;
    }
    socket.startHeartbeat();
    return socket.stopHeartbeat;
  }, [connectionStatus, practiceStatus, socket]);

  const sendPracticeControl = (type: 'client.pause' | 'client.resume' | 'client.finish' | 'client.skip') => {
    return socket.sendJson({
      protocol_version: PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
      type,
      payload: { t: Date.now() },
    });
  };

  const sendPracticeInit = (detail: PracticeSessionDetailRead) => {
    if (
      !socket.sendJson({
        protocol_version: PRACTICE_WEBSOCKET_PROTOCOL_VERSION,
        type: 'client.init',
        payload: {
          sample_rate: detail.sample_rate,
          channels: detail.channels,
          frame_samples: 640,
          progression_mode: detail.progression_mode,
          realtime_guidance: detail.realtime_guidance,
          evaluation_profile: detail.evaluation_profile,
          input_source: detail.input_source,
        },
      })
    ) {
      throw new Error('Practice websocket is not ready.');
    }
  };

  const finishLocalPractice = (
    sessionId: string | null,
    completionOutcome: PracticeSessionCompletionOutcomeRead
  ) => {
    finishLocalPerformanceCapture();
    clearFinishRecoveryTimer();
    audioStream.setStreaming(false);
    midiStream.setStreaming(false);
    setPracticeClockStarted(false);
    clearPerformanceClockSync();
    audioStream.teardown();
    midiStream.teardown();
    localMidiReplayEventsRef.current = [];
    setConnectionStatus('disconnected');
    updatePracticeStatus('finished');
    setCompletedSessionId(sessionId);
    setCompletedOutcome(completionOutcome);
    if (!sessionId || !completionOutcome.playback_expected) {
      setLocalReplayFinalizationState({ status: 'not_expected' });
    } else {
      setLocalReplayFinalizationState({ status: 'finalizing', sessionId });
    }
    setIsCompletionDialogOpen(true);
  };

  const recoverFinishedSession = (sessionId: string | null) => {
    if (!sessionId) {
      return;
    }
    clearFinishRecoveryTimer();
    finishRecoveryTimerRef.current = window.setTimeout(() => {
      void practiceApi
        .getPracticeSession(sessionId)
        .then((response) => {
          const detail = response.data;
          if (detail?.state !== 'FINISHED' || !detail.completion_outcome) {
            return;
          }
          practiceSession.sync(detail);
          finishLocalPractice(sessionId, detail.completion_outcome);
          socket.close();
        })
        .catch((error) => {
          reportUnexpectedClientError(error, {
            area: 'practice',
            action: 'recover_finished_session',
            score_id: id,
          });
        });
    }, 1500);
  };

  const showInputHealthToast = (inputHealth: PracticeInputHealth) => {
    if (!inputHealth.available) {
      toast({
        variant: 'destructive',
        title: t('inputUnavailableTitle'),
        description: t('inputUnavailableDesc'),
      });
      return;
    }
    if (inputHealth.level === 'clipping') {
      toast({
        variant: 'destructive',
        title: t('inputClippingTitle'),
        description: t('inputClippingDesc'),
      });
      return;
    }
    if (inputHealth.noise === 'high') {
      toast({
        title: t('inputNoiseHighTitle'),
        description: t('inputNoiseHighDesc'),
      });
      return;
    }
    if (inputHealth.noise === 'elevated') {
      toast({
        title: t('inputNoiseElevatedTitle'),
        description: t('inputNoiseElevatedDesc'),
      });
    }
  };

  function handleSocketMessage(message: PracticeServerMessage) {
    if (message.type === 'session.ready') {
      setConnectionStatus('ready');
      if (
        activeInputSourceRef.current === 'MIDI' &&
        activeSessionModeRef.current === 'STEP_BY_STEP'
      ) {
        midiStream.setStreaming(true);
      } else if (activeInputSourceRef.current === 'MICROPHONE') {
        audioStream.setStreaming(true);
      }
      practiceSession.updateState(message.payload.state);
      return;
    }

    if (message.type === 'session.armed') {
      if (practiceStatusRef.current !== 'finished') {
        setPracticeClockStarted(activeSessionModeRef.current === 'STEP_BY_STEP');
        updatePracticeStatus('listening');
        showInputHealthToast(message.payload.input_health);
      }
      return;
    }

    if (message.type === 'alignment.update') {
      if (activeSessionModeRef.current !== 'STEP_BY_STEP') {
        return;
      }
      if (practiceStatusRef.current === 'listening') {
        updatePracticeStatus('practicing');
      }
      setAlignment(message.payload);
      clearPerformanceClockSync();
      setPerformanceTimeline(null);
      if (message.payload.scope_completed && practiceStatusRef.current !== 'finished') {
        audioStream.setStreaming(false);
        midiStream.setStreaming(false);
        setPracticeClockStarted(false);
        updatePracticeStatus('finishing');
        recoverFinishedSession(practiceSession.getSessionId());
      }
      return;
    }

    if (message.type === 'performance.timeline') {
      if (activeSessionModeRef.current !== 'CONTINUOUS_PLAY') {
        return;
      }
      setPerformanceTimeline(message.payload);
      return;
    }

    if (
      message.type === 'performance.clock_sync' ||
      message.type === 'performance.started' ||
      message.type === 'performance.paused' ||
      message.type === 'performance.resumed' ||
      message.type === 'performance.ended'
    ) {
      if (activeSessionModeRef.current !== 'CONTINUOUS_PLAY') {
        return;
      }
      performanceSpeedRatioRef.current = message.payload.speed_ratio;
      updatePerformanceClockSync(message.payload);
      setAlignment(null);
      if (practiceStatusRef.current !== 'finished') {
        if (message.type === 'performance.started') {
          if (message.payload.state === 'RUNNING') {
            startLocalPerformanceCapture();
          }
          setPracticeClockStarted(message.payload.state === 'RUNNING');
          updatePracticeStatus(
            message.payload.state === 'COUNT_IN' ? 'listening' : 'practicing'
          );
        } else if (message.type === 'performance.paused') {
          pauseLocalPerformanceCapture();
          setPracticeClockStarted(false);
          updatePracticeStatus('paused');
        } else if (message.type === 'performance.resumed') {
          if (message.payload.state === 'RUNNING') {
            startLocalPerformanceCapture();
          }
          setPracticeClockStarted(message.payload.state === 'RUNNING');
          updatePracticeStatus(
            message.payload.state === 'COUNT_IN' ? 'listening' : 'practicing'
          );
        } else if (message.type === 'performance.ended') {
          finishLocalPerformanceCapture();
          setPracticeClockStarted(false);
          updatePracticeStatus('finishing');
        } else if (message.payload.state === 'RUNNING') {
          startLocalPerformanceCapture();
          setPracticeClockStarted(true);
          updatePracticeStatus('practicing');
        } else if (message.payload.state === 'COUNT_IN') {
          setPracticeClockStarted(false);
          updatePracticeStatus('listening');
        }
      }
      return;
    }

    if (message.type === 'session.state_changed') {
      if (practiceStatusRef.current === 'finished') {
        return;
      }

      const isPerformanceResumeCountIn =
        activeSessionModeRef.current === 'CONTINUOUS_PLAY' &&
        message.payload.state === 'STREAMING' &&
        performanceClockSyncRef.current?.state === 'COUNT_IN';
      const nextStatus =
        message.payload.state === 'PAUSED'
          ? 'paused'
          : isPerformanceResumeCountIn
            ? 'listening'
            : practiceStatusRef.current === 'paused'
              ? pausedPracticeStatusRef.current
              : 'practicing';
      updatePracticeStatus(nextStatus);
      practiceSession.updateState(message.payload.state);
      return;
    }

    if (message.type === 'session.finished') {
      clearFinishRecoveryTimer();
      practiceSession.updateFinished(
        message.payload.state,
        message.payload.completion_outcome
      );
      finishLocalPractice(
        practiceSession.getSessionId(),
        message.payload.completion_outcome
      );
      socket.close();
      return;
    }

    if (message.type === 'session.error') {
      setConnectionStatus('error');
      audioStream.setStreaming(false);
      midiStream.setStreaming(false);
      setIsPreparingSession(false);
      clearPerformanceClockSync();
      setPerformanceTimeline(null);
      setCompletedLocalMidiReplay(null);
      localReplayCaptureActiveRef.current = false;
      localMidiReplayEventsRef.current = [];
      recording.reset();
      practiceSession.clear();
      if (practiceStatusRef.current === 'connecting') {
        updatePracticeStatus('idle');
      }
      socket.close();
      toast({
        variant: 'destructive',
        title: t('prepareFailedTitle'),
        description: translateErrorCode(
          errors,
          message.payload.public_code,
          t('prepareFailedDesc')
        ),
      });
    }
  }

  function handleSocketClose(wasIntentional: boolean) {
    const wasActive =
      practiceStatusRef.current === 'connecting' ||
      practiceStatusRef.current === 'listening' ||
      practiceStatusRef.current === 'practicing' ||
      practiceStatusRef.current === 'paused';
    audioStream.setStreaming(false);
    midiStream.setStreaming(false);
    setConnectionStatus('disconnected');
    if (practiceStatusRef.current === 'finishing') {
      return;
    }
    if (wasActive && !wasIntentional) {
      localReplayCaptureActiveRef.current = false;
      localMidiReplayEventsRef.current = [];
      recording.reset();
      updatePracticeStatus('idle');
      setIsPreparingSession(false);
      toast({
        variant: 'destructive',
        title: t('prepareFailedTitle'),
        description: t('connectionClosedDesc'),
      });
    } else if (!wasIntentional && !wasActive) {
      setIsPreparingSession(false);
      setConnectionStatus('error');
    }
  }

  const handlePracticeModeChange = (practiceMode: PracticeSessionMode) => {
    if (
      practiceMode === selectedPracticeMode ||
      practiceStatusRef.current !== 'idle'
    ) {
      return;
    }
    clearFinishRecoveryTimer();
    practiceSession.clear();
    socket.close();
    setAlignment(null);
    clearPerformanceClockSync();
    setPerformanceTimeline(null);
    setCompletedLocalMidiReplay(null);
    localReplayCaptureActiveRef.current = false;
    localMidiReplayEventsRef.current = [];
    recording.reset();
    setConnectionStatus('disconnected');
    setSelectedPracticeMode(practiceMode);
    updateActiveSessionMode(practiceMode);
  };

  const handlePracticeInputSourceChange = (inputSource: PracticeInputSource) => {
    if (
      inputSource === practiceInputSource ||
      practiceStatusRef.current !== 'idle'
    ) {
      return;
    }
    clearFinishRecoveryTimer();
    practiceSession.clear();
    socket.close();
    setAlignment(null);
    clearPerformanceClockSync();
    setPerformanceTimeline(null);
    setCompletedLocalMidiReplay(null);
    localReplayCaptureActiveRef.current = false;
    localMidiReplayEventsRef.current = [];
    recording.reset();
    setConnectionStatus('disconnected');
    activeInputSourceRef.current = inputSource;
    setPracticeInputSource(inputSource);
  };

  const handleStart = async () => {
    if (!canEnterPractice) {
      return;
    }

    if (!selectedInputSupported) {
      toast({
        variant: 'destructive',
        title:
          practiceInputSource === 'MIDI'
            ? t('midiUnsupportedTitle')
            : t('audioWorkletUnsupportedTitle'),
        description:
          practiceInputSource === 'MIDI'
            ? t('midiUnsupportedDesc')
            : t('audioWorkletUnsupportedDesc'),
      });
      return;
    }

    setIsLoading(true);
    clearFinishRecoveryTimer();
    setIsCompletionDialogOpen(false);
    setCompletedSessionId(null);
    setCompletedOutcome(null);
    setCompletedLocalMidiReplay(null);
    setLocalReplayFinalizationState({ status: 'not_expected' });
    setPendingReportHandoffSessionId(null);
    localReplayCaptureActiveRef.current = false;
    localMidiReplayEventsRef.current = [];
    runningPracticeScopeRef.current = null;
    recording.reset();
    setAlignment(null);
    clearPerformanceClockSync();
    setPerformanceTimeline(null);
    setPracticeTime(0);
    setPracticeClockStarted(false);
    updatePracticeStatus('connecting');
    setIsPreparingSession(true);
    setConnectionStatus('connecting');
    practiceSession.clear();
    socket.close();

    try {
      activeInputSourceRef.current = practiceInputSource;
      if (practiceInputSource === 'MIDI') {
        await midiStream.setup();
      } else {
        const stream = await audioStream.setup();
        recording.attach(stream);
      }
      const createdSession = await practiceSession.create();
      if (!createdSession) {
        throw new Error('Practice session creation was superseded.');
      }

      const { detail, wsUrl } = createdSession;
      await socket.open(wsUrl);
      setConnectionStatus('ready');

      updateActiveSessionMode(detail.preset);
      activeInputSourceRef.current = detail.input_source;
      runningPracticeScopeRef.current = detail.practice_scope ?? activePracticeScope ?? null;
      sendPracticeInit(detail);
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'practice',
        action: 'start_session',
        score_id: id,
      });
      const isUnsupportedRealtimeAudio =
        error instanceof Error && error.message === 'practice_realtime_audio_unsupported';
      const isUnsupportedMidi =
        error instanceof Error && error.message === 'practice_realtime_midi_unsupported';
      const hasNoMidiInput =
        error instanceof Error && error.message === 'practice_realtime_midi_no_inputs';
      const isMidiAccessDenied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' ||
          error.name === 'PermissionDeniedError' ||
          error.name === 'SecurityError');
      const isMicrophoneAccessDenied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      updatePracticeStatus('idle');
      updateActiveSessionMode(selectedPracticeMode);
      setPracticeClockStarted(false);
      setConnectionStatus('disconnected');
      practiceSession.clear();
      audioStream.teardown();
      midiStream.teardown();
      if (isMicrophoneAccessDenied) {
        toast({
          variant: 'destructive',
          title: t('micAccessDeniedTitle'),
          description: t('micAccessDeniedDesc'),
        });
      } else if (isMidiAccessDenied) {
        toast({
          variant: 'destructive',
          title: t('midiAccessDeniedTitle'),
          description: t('midiAccessDeniedDesc'),
        });
      } else if (hasNoMidiInput) {
        toast({
          variant: 'destructive',
          title: t('midiNoInputTitle'),
          description: t('midiNoInputDesc'),
        });
      } else {
        setConnectionStatus('error');
        socket.close();
        toast({
          variant: 'destructive',
          title:
            isUnsupportedRealtimeAudio || isUnsupportedMidi
              ? practiceInputSource === 'MIDI'
                ? t('midiUnsupportedTitle')
                : t('audioWorkletUnsupportedTitle')
              : t('prepareFailedTitle'),
          description:
            isUnsupportedRealtimeAudio || isUnsupportedMidi
              ? practiceInputSource === 'MIDI'
                ? t('midiUnsupportedDesc')
                : t('audioWorkletUnsupportedDesc')
              : t('prepareFailedDesc'),
        });
      }
    } finally {
      setIsLoading(false);
      setIsPreparingSession(false);
    }
  };

  const handlePause = () => {
    const sessionId = practiceSession.getSessionId();
    if (!sessionId) {
      return;
    }

    if (practiceStatus === 'listening' || practiceStatus === 'practicing') {
      pausedPracticeStatusRef.current = practiceStatus;
      audioStream.setStreaming(false);
      midiStream.setStreaming(false);
      pauseLocalPerformanceCapture();
      updatePracticeStatus('paused');

      if (!sendPracticeControl('client.pause')) {
        void practiceSession
          .runRestControl('pause', sessionId)
          .catch(() => undefined);
      }
      return;
    }

    if (practiceStatus === 'paused') {
      if (activeSessionModeRef.current === 'STEP_BY_STEP') {
        audioStream.setStreaming(true);
        midiStream.setStreaming(true);
        updatePracticeStatus(pausedPracticeStatusRef.current);
      }

      if (!sendPracticeControl('client.resume')) {
        void practiceSession
          .runRestControl('resume', sessionId)
          .catch(() => undefined);
      }
    }
  };

  const handleFinish = () => {
    const currentSessionId = practiceSession.getSessionId();
    if (!currentSessionId) {
      return;
    }

    if (sendPracticeControl('client.finish')) {
      finishLocalPerformanceCapture();
      return;
    }

    finishLocalPerformanceCapture();

    void practiceSession
      .runRestControl('finish', currentSessionId)
      .then((detail) => {
        if (!detail?.completion_outcome) {
          throw new Error('Finished practice session is missing completion outcome.');
        }
        finishLocalPractice(currentSessionId, detail.completion_outcome);
      })
      .catch(() => undefined)
      .finally(() => {
        socket.close();
      });
  };

  const handleRestart = () => {
    recording.reset();
    clearFinishRecoveryTimer();
    updatePracticeStatus('idle');
    setIsCompletionDialogOpen(false);
    setCompletedSessionId(null);
    setCompletedOutcome(null);
    setCompletedLocalMidiReplay(null);
    setLocalReplayFinalizationState({ status: 'not_expected' });
    setPendingReportHandoffSessionId(null);
    localReplayCaptureActiveRef.current = false;
    localMidiReplayEventsRef.current = [];
    runningPracticeScopeRef.current = null;
    setAlignment(null);
    clearPerformanceClockSync();
    setPerformanceTimeline(null);
    updateActiveSessionMode(selectedPracticeMode);
    setPracticeTime(0);
    setPracticeClockStarted(false);
  };

  const handleSkip = () => {
    if (
      activeSessionModeRef.current !== 'STEP_BY_STEP' ||
      (practiceStatusRef.current !== 'listening' && practiceStatusRef.current !== 'practicing')
    ) {
      return;
    }
    sendPracticeControl('client.skip');
  };

  const handleAdjustSelectedSection = () => {
    recording.reset();
    clearFinishRecoveryTimer();
    practiceSession.clear();
    socket.close();
    updatePracticeStatus('idle');
    setConnectionStatus('disconnected');
    setIsCompletionDialogOpen(false);
    setCompletedSessionId(null);
    setCompletedOutcome(null);
    setCompletedLocalMidiReplay(null);
    setLocalReplayFinalizationState({ status: 'not_expected' });
    setPendingReportHandoffSessionId(null);
    localReplayCaptureActiveRef.current = false;
    localMidiReplayEventsRef.current = [];
    runningPracticeScopeRef.current = null;
    setAlignment(null);
    clearPerformanceClockSync();
    setPerformanceTimeline(null);
    updateActiveSessionMode(selectedPracticeMode);
    setPracticeTime(0);
    setPracticeClockStarted(false);
    setRangeSelection(selectedPracticeRangeSelection());
    router.push(`/${locale}/score/${id}/practice`);
  };

  const navigateToSummary = useCallback(
    (summarySessionId: string) => {
      router.push(
        `/${locale}/score/${id}/practice/summary?sessionId=${encodeURIComponent(summarySessionId)}`
      );
    },
    [id, locale, router]
  );

  useEffect(() => {
    const completedHandoffSessionId = completedReportHandoffSessionId(
      pendingReportHandoffSessionId,
      localReplayFinalizationState
    );
    if (!completedHandoffSessionId) {
      return;
    }
    setPendingReportHandoffSessionId(null);
    navigateToSummary(completedHandoffSessionId);
  }, [
    localReplayFinalizationState,
    navigateToSummary,
    pendingReportHandoffSessionId,
  ]);

  const handleViewSummary = () => {
    const summarySessionId = completedSessionId ?? practiceSession.getSessionId();
    if (!summarySessionId) {
      return;
    }
    if (
      shouldWaitForLocalReplayHandoff(summarySessionId, localReplayFinalizationState)
    ) {
      setPendingReportHandoffSessionId(summarySessionId);
      return;
    }
    navigateToSummary(summarySessionId);
  };

  const isCompletionSummaryActionLoading =
    isLoading ||
    Boolean(pendingReportHandoffSessionId);
  const isStepByStepSessionActive =
    activeSessionMode === 'STEP_BY_STEP' &&
    (practiceStatus === 'listening' ||
      practiceStatus === 'practicing' ||
      practiceStatus === 'paused');
  const canSkipCurrentStep =
    activeSessionMode === 'STEP_BY_STEP' &&
    (practiceStatus === 'listening' || practiceStatus === 'practicing');

  const practiceControls = (
    <PracticeControls
      status={practiceStatus}
      connectionStatus={connectionStatus}
      isLoading={isLoading}
      isPreparingSession={isPreparingSession}
      canPrepareSession={canPreparePractice}
      audioWorkletSupported={selectedInputSupported}
      rangeSelectionActive={hasManualRangeSelection}
      canSelectRange={canSelectRange}
      onStart={() => void handleStart()}
      onPause={handlePause}
      onFinish={handleFinish}
      onOpenSettings={() => setIsSettingsOpen(true)}
      onToggleRangeSelection={handleToggleRangeSelection}
    />
  );

  const practiceSessionStatus = (
    <PracticeSessionStatus
      className="border-0 bg-transparent px-0 py-0 shadow-none"
      status={practiceStatus}
      connectionStatus={connectionStatus}
      isLoading={isLoading}
      isPreparingSession={isPreparingSession}
      canPrepareSession={canPreparePractice}
      audioWorkletSupported={selectedInputSupported}
      sessionMode={activeSessionMode}
      practiceClockStarted={practiceClockStarted}
      practiceTime={practiceTime}
      alignment={alignment}
      performanceClockSync={performanceClockSync}
      performanceClockSyncReceivedAtMs={performanceClockSyncReceivedAtMs}
    />
  );

  const renderFrame = (children: React.ReactNode) => (
    <ScoreSurface>
      <div className="w-full">{children}</div>
    </ScoreSurface>
  );

  if (isResourceLoading) {
    return renderFrame(
      <ResourceLoading label={common('loadingScoreData')} />
    );
  }

  if (loadErrorDescription) {
    return renderFrame(
      <ResourceLoadError
        title={common('loadFailed')}
        description={loadErrorDescription}
        actionLabel={common('back')}
        onAction={() => router.back()}
      />
    );
  }

  return renderFrame(
    <>
      {scoreCapabilities && !scoreCapabilities.can_practice ? (
        <WorkspaceAccessDenied
          title={t('accessDeniedTitle')}
          description={t('accessDeniedDesc')}
          backHref={`/score/${id}`}
          backLabel={common('back')}
        />
      ) : (
      <>
      {rangeSelectionDescription ? (
        <div className="border-b border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-6xl flex-col gap-1">
            <p className="font-medium">{t('selectedSectionPracticeTitle')}</p>
            <p className="text-orange-800">{rangeSelectionDescription}</p>
          </div>
        </div>
      ) : null}
      <div className="min-h-[calc(100vh-4rem)] xl:flex xl:h-[calc(100dvh-4rem)] xl:min-h-[38rem] xl:flex-col">
        <div className="min-h-0 xl:flex xl:flex-1">
          <main className="min-w-0 xl:flex xl:h-full xl:min-h-0 xl:flex-1 xl:flex-col">
            <div className="relative flex min-h-[38rem] flex-col pb-28 xl:h-full xl:min-h-0 xl:flex-1">
              <ClientOnly>
                <PracticeScoreViewer
                  className="rounded-none border-0 shadow-none xl:min-h-0 xl:flex-1"
                  sessionStatus={practiceSessionStatus}
                  xmlContent={xmlContent || null}
                  isLoadingXml={isLoadingXml}
                  practiceStatus={practiceStatus}
                  alignment={displayAlignment}
                  performanceClockSync={performanceClockSync}
                  performanceTimeline={performanceTimeline}
                  sessionMode={activeSessionMode}
                  selectedRangeRenderNoteIds={activeRangeSelectionVisual.renderNoteIds}
                  selectedRangeStartRenderNoteIds={activeRangeSelectionVisual.startRenderNoteIds}
                  selectedRangeEndRenderNoteIds={activeRangeSelectionVisual.endRenderNoteIds}
                  onRenderNoteClick={
                    isManualRangeSelectionPending ? handleRenderNoteClick : undefined
                  }
                />
              </ClientOnly>
            </div>
          </main>
        </div>
      </div>
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-3 px-3">
        <div className="pointer-events-auto flex w-full justify-end">
          <PracticeSkipControl
            visible={isStepByStepSessionActive}
            disabled={!canSkipCurrentStep}
            onSkip={handleSkip}
          />
        </div>
        <div className="pointer-events-auto w-fit max-w-full rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-lg">
          {practiceControls}
        </div>
      </div>
      <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <SheetContent side="right" className="w-full max-w-sm overflow-y-auto p-0 sm:max-w-sm">
          <SheetTitle className="sr-only">{t('settingsTitle')}</SheetTitle>
          <SheetDescription className="sr-only">{t('settingsSubtitle')}</SheetDescription>
          <PracticeSettingsPanel
            className="min-h-full rounded-none border-0 shadow-none"
            connectionStatus={connectionStatus}
            hasMicPermission={hasMicPermission}
            audioWorkletSupported={audioWorkletSupported}
            midiSupported={midiStream.isSupported}
            hasMidiPermission={midiStream.hasMidiPermission}
            hasMidiInput={midiStream.hasConnectedInput}
            practiceMode={selectedPracticeMode}
            practiceModeLocked={practiceStatus !== 'idle'}
            inputSource={practiceInputSource}
            microphoneInputLocked={practiceStatus !== 'idle'}
            midiInputLocked={practiceStatus !== 'idle'}
            onPracticeModeChange={handlePracticeModeChange}
            onInputSourceChange={handlePracticeInputSourceChange}
          />
        </SheetContent>
      </Sheet>
      </>
      )}
      {completionOutcome ? (
        <PracticeCompletionDialog
          open={isCompletionDialogOpen}
          outcome={completionOutcome}
          sessionMode={activeSessionMode}
          isLoading={isCompletionSummaryActionLoading}
          onOpenChange={setIsCompletionDialogOpen}
          onRestart={handleRestart}
          onAdjustSection={handleAdjustSelectedSection}
          onViewSummary={handleViewSummary}
        />
      ) : null}
    </>
  );
}
