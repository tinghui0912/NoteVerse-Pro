'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useScoreDetail } from '@/hooks/queries/use-score-queries';
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { usePracticeScoreArtifact } from '@/hooks/practice/use-practice-score-artifact';
import { useLocalPractice } from '@/hooks/practice/use-local-practice';
import { usePracticeCameraRecording } from '@/hooks/practice/use-practice-camera-recording';
import { usePracticeRangeSelection } from '@/hooks/practice/use-practice-range-selection';
import { ClientOnly } from '@/components/client-only';
import { PracticeScoreViewer } from '@/components/practice/practice-score-viewer';
import { StepPracticeControls, ContinuousPracticeControls } from '@/components/practice/practice-controls';
import { PracticeCompletionDialog } from '@/components/practice/practice-completion-dialog';
import { PracticeSettingsPanel } from '@/components/practice/practice-settings-panel';
import { PracticeStatus } from '@/components/practice/practice-status';
import { PracticeSkipControl } from '@/components/practice/practice-skip-control';
import { ResourceLoadError } from '@/components/states';
import { ResourceLoading } from '@/components/loading';
import { ScoreSurface } from '@/components/score/score-surface';
import { WorkspaceAccessDenied } from '@/components/score/workspace-access-denied';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { resolvePracticeScope } from '@/lib/practice/kernel/scope';
import { type ExpectedPracticeGroup } from '@/lib/practice/kernel/artifact';
import { type PracticeInputSource, type PracticeMode } from '@/lib/practice/kernel/session';
import type { PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import {
  evaluatePracticeInputCapabilities,
  getSelectedInputCapability,
  getSelectedMicrophoneCapability,
} from '@/lib/practice/input-capability';
import type { PracticeCompletionOutcome } from '@/lib/practice/completion-outcome';

function CameraPreview({
  stream,
  label,
}: {
  stream: MediaStream;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 w-48 overflow-hidden rounded-md border border-slate-200 bg-slate-950 shadow-lg">
      <video
        ref={videoRef}
        muted
        playsInline
        className="aspect-video w-full bg-black object-cover"
        aria-label={label}
      />
      <div className="bg-white px-2 py-1 text-xs font-medium text-slate-700">{label}</div>
    </div>
  );
}

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id } = resolvedParams;
  const t = useTranslations('practice');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Mode and settings
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('STEP_BY_STEP');
  const [inputSource, setInputSource] = useState<PracticeInputSource>('MICROPHONE');
  const [tempoSelection, setTempoSelection] = useState<PracticeTempoSelection>({ mode: 'SCORE' });
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);

  // Score details and assets
  const scoreQuery = useScoreDetail(id);
  const scoreCapabilities = scoreQuery.data?.data?.capabilities;
  const canEnterPractice = scoreCapabilities?.can_practice !== false;
  const requestedRevisionId = searchParams.get('practiceRevisionId');
  const headRevisionId = scoreQuery.data?.data?.head_revision_id ?? null;
  useEffect(() => {
    if (requestedRevisionId || !headRevisionId) {
      return;
    }
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('practiceRevisionId', headRevisionId);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  }, [headRevisionId, pathname, requestedRevisionId, router, searchParams]);
  const selectedRevisionId = requestedRevisionId ?? headRevisionId ?? undefined;

  const revisionQuery = usePracticeReadyScoreContent(
    id,
    selectedRevisionId,
    canEnterPractice && Boolean(selectedRevisionId)
  );
  const xmlContent = revisionQuery.data?.data?.content ?? null;

  // Artifact query
  const artifactQuery = usePracticeScoreArtifact(
    id,
    selectedRevisionId,
    canEnterPractice && Boolean(selectedRevisionId)
  );
  const artifact = artifactQuery.data ?? null;

  // Range interaction uses the artifact's expected groups.
  const expectedGroups: readonly ExpectedPracticeGroup[] = useMemo(
    () => artifact?.expectedPracticeGroups ?? [],
    [artifact]
  );

  const range = usePracticeRangeSelection(expectedGroups);
  const { practiceScope, selectedRangeRenderNoteIds } = range;

  const resolvedScope = useMemo(() => {
    if (!artifact || expectedGroups.length === 0) return null;
    if (!practiceScope) return null;
    return resolvePracticeScope(artifact, practiceScope);
  }, [artifact, expectedGroups.length, practiceScope]);

  const scopeStartBeat = resolvedScope?.startBeat ?? 0;

  const cameraMessages = useMemo(() => ({
    continuousOnly: t('settingCameraContinuousOnly'),
    unsupported: t('settingCameraUnsupported'),
    preparing: t('settingCameraPreparing'),
    ready: t('settingCameraReady'),
    permissionDenied: t('settingCameraPermissionDenied'),
    unavailable: t('settingCameraUnavailable'),
    audioMissing: t('settingCameraAudioMissing'),
    videoMissing: t('settingCameraVideoMissing'),
  }), [t]);
  const { recordingMode, cameraPreviewStream, cameraStatusMessage, isPreparingCamera,
    changeRecordingMode, releaseCameraPreview } = usePracticeCameraRecording({
    practiceMode, inputSource, messages: cameraMessages,
  });

  // Local Practice orchestration
  const localPractice = useLocalPractice({
    artifact,
    mode: practiceMode,
    inputSource,
    scope: practiceScope,
    tempoSelection,
    metronomeEnabled,
    recordingMode: practiceMode === 'CONTINUOUS_PLAY' ? recordingMode : 'OFF',
    cameraMediaStream: cameraPreviewStream,
    onNaturalCompletion: snapshot => {
      if (snapshot.completionReason !== 'SCOPE_COMPLETED') return;
      releaseCameraPreview();
      setIsCompletionDialogOpen(true);
    },
  });

  const handleMetronomeEnabledChange = useCallback(
    (enabled: boolean) => {
      setMetronomeEnabled(enabled);
      localPractice.setMetronomeEnabled(enabled);
    },
    [localPractice]
  );

  const isLoadingXml = scoreQuery.isLoading || revisionQuery.isLoading || artifactQuery.isLoading;
  const isResourceLoading =
    scoreQuery.isLoading || (Boolean(selectedRevisionId) && (revisionQuery.isLoading || artifactQuery.isLoading));
  const loadError = scoreQuery.error ?? revisionQuery.error ?? artifactQuery.error;
  const resourceMissingAfterLoad = !isResourceLoading && !loadError && (!selectedRevisionId || !xmlContent || !artifact);
  const loadErrorDescription = loadError
    ? userFacingErrorMessage(errors, loadError, common('loadFailedDescription'))
    : resourceMissingAfterLoad
      ? common('loadFailedDescription')
      : null;

  const canPreparePractice =
    canEnterPractice &&
    Boolean(selectedRevisionId && xmlContent && artifact) &&
    Boolean(practiceScope) &&
    !range.isIncomplete &&
    !isResourceLoading &&
    !loadError;

  const handleRestart = async () => {
    setIsCompletionDialogOpen(false);
    await localPractice.restart();
  };

  const handleViewSummary = useCallback(() => {
    setIsCompletionDialogOpen(false);
    router.push(`/score/${id}/practice/review`);
  }, [id, router]);

  const handleAdjustSelectedSection = () => {
    setIsCompletionDialogOpen(false);
    range.beginSelection();
  };

  const completionOutcome: PracticeCompletionOutcome = useMemo(() => {
    if (range.isRangeScopeReady) {
      return {
        kind: 'selected-section',
      };
    }
    return {
      kind: practiceMode === 'CONTINUOUS_PLAY' ? 'full-piece-performance' : 'full-piece-learning',
    };
  }, [practiceMode, range.isRangeScopeReady]);

  const isStepMode = practiceMode === 'STEP_BY_STEP';
  const isActive =
    localPractice.inputState === 'STARTING' ||
    localPractice.lifecycle === 'ACTIVE' ||
    localPractice.lifecycle === 'PAUSED';

  const inputCapabilities = useMemo(() => evaluatePracticeInputCapabilities(), []);
  const selectedInputCapability = useMemo(
    () => getSelectedInputCapability(inputSource, inputCapabilities, practiceMode),
    [inputCapabilities, inputSource, practiceMode]
  );
  const selectedMicrophoneCapability = useMemo(
    () => getSelectedMicrophoneCapability(inputCapabilities, practiceMode),
    [inputCapabilities, practiceMode]
  );

  const rangeSelectionPrompt = useMemo(() => {
    if (range.phase === 'selected' && range.selectedMeasureRange) {
      const { start: startMeasure, end: endMeasure } = range.selectedMeasureRange;
      const rangeText =
        startMeasure && endMeasure && startMeasure !== endMeasure
          ? `${startMeasure}–${endMeasure}`
          : (startMeasure ?? '');
      return t('sectionSelectedRange', { range: rangeText });
    }
    if (range.phase === 'selecting-start') {
      return t('sectionSelectingStart');
    }
    if (range.phase === 'selecting-end') {
      return t('sectionSelectingEnd');
    }
    return null;
  }, [range.phase, range.selectedMeasureRange, t]);

  const controlSurfaceProps = {
      isLoading: isLoadingXml,
      isPreparingSession: localPractice.inputState === 'STARTING',
      canPrepareSession: canPreparePractice,
      selectedInputCapability,
      selectedInputSupported: selectedInputCapability.supported,
      rangeSelectionActive: range.rangeSelectionActive,
      canSelectRange: !isActive,
      tempoSelection,
      scoreTempoSegments: artifact?.scoreTempoSegments,
      scopeStartBeat,
      tempoLocked: isActive,
      onTempoSelectionChange: setTempoSelection,
      metronomeEnabled,
      onMetronomeEnabledChange: handleMetronomeEnabledChange,
      onStart: () => void localPractice.start(),
      onEnd: () => { void localPractice.abandon(); },
      onOpenSettings: () => setIsSettingsOpen(true),
      onToggleRangeSelection: range.toggleSelection,
  };
  const practiceControls = localPractice.mode === 'STEP_BY_STEP'
    ? <StepPracticeControls {...controlSurfaceProps} lifecycle={localPractice.lifecycle} />
    : <ContinuousPracticeControls {...controlSurfaceProps} lifecycle={localPractice.lifecycle}
        onPause={() => void localPractice.pause()} onResume={() => void localPractice.resume()} />;

  const practiceSessionStatus = (
    <PracticeStatus
      className="border-0 bg-transparent px-0 py-0 shadow-none"
      lifecycle={localPractice.lifecycle}
      inputState={localPractice.inputState}
      inputError={localPractice.inputError}
      inputSource={inputSource}
      selectedInputCapability={selectedInputCapability}
      rangePrompt={rangeSelectionPrompt}
      sessionMode={practiceMode}
      practiceTime={localPractice.elapsedSeconds}
      performanceClock={localPractice.performanceClock}
      stepInteractionPhase={localPractice.mode === 'STEP_BY_STEP' ? localPractice.stepInteractionPhase : null}
      pendingPostVerdict={localPractice.mode === 'STEP_BY_STEP' ? localPractice.pendingPostVerdict : null}
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
          <div className="min-h-[calc(100vh-4rem)] xl:flex xl:h-[calc(100dvh-4rem)] xl:min-h-[38rem] xl:flex-col">
            <main className="min-w-0 xl:flex xl:h-full xl:min-h-0 xl:flex-1 xl:flex-col">
              <div className="relative flex min-h-[38rem] flex-col pb-28 xl:h-full xl:min-h-0 xl:flex-1">
                <ClientOnly>
                  <PracticeScoreViewer
                    className="rounded-none border-0 shadow-none xl:min-h-0 xl:flex-1"
                    sessionStatus={practiceSessionStatus}
                    xmlContent={xmlContent}
                    isLoadingXml={isLoadingXml}
                    lifecycle={localPractice.lifecycle}
                    sessionMode={practiceMode}
                    activeStepGroup={localPractice.activeStepGroup}
                    performanceMusicalBeat={localPractice.performanceClock?.musicalBeat ?? null}
                    performanceEvaluation={localPractice.performanceEvaluation}
                    performanceScope={
                      localPractice.performanceClock
                        ? range.hasRangeSelection
                          ? {
                              kind: 'RANGE' as const,
                              startBeat: localPractice.performanceClock.scopeStartBeat,
                              terminalBeat: localPractice.performanceClock.scopeTerminalBeat,
                              allowedNoteIds: selectedRangeRenderNoteIds,
                            }
                          : {
                              kind: 'FULL' as const,
                              startBeat: localPractice.performanceClock.scopeStartBeat,
                              terminalBeat: localPractice.performanceClock.scopeTerminalBeat,
                            }
                        : null
                    }
                    selectedRangeRenderNoteIds={selectedRangeRenderNoteIds}
                    onRenderNoteClick={range.isSelecting ? range.selectRenderNote : undefined}
                  />
                </ClientOnly>

                {localPractice.mode === 'STEP_BY_STEP' && isActive ? (
                  <div className="pointer-events-none absolute bottom-24 right-6 z-30">
                    <PracticeSkipControl
                      visible={true}
                      disabled={!localPractice.canAcceptAttempt}
                      onSkip={localPractice.skip}
                    />
                  </div>
                ) : null}

                {!isStepMode && recordingMode === 'VIDEO' && cameraPreviewStream ? (
                  <CameraPreview stream={cameraPreviewStream} label={t('settingCameraPreview')} />
                ) : null}

                <footer className="absolute bottom-0 left-0 right-0 z-20 flex min-h-20 items-center justify-between border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6">
                  <div className="flex w-full items-center justify-between">
                    {practiceControls}
                  </div>
                </footer>
              </div>
            </main>
          </div>

          <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <SheetContent side="right" className="w-full p-0 sm:max-w-md">
              <SheetTitle className="sr-only">{t('settingsTitle')}</SheetTitle>
              <SheetDescription className="sr-only">{t('settingsSubtitle')}</SheetDescription>
              <PracticeSettingsPanel
                className="h-full rounded-none border-0 shadow-none"
                inputState={localPractice.inputState}
                microphoneCapability={selectedMicrophoneCapability}
                midiCapability={inputCapabilities.midi}
                practiceMode={practiceMode}
                practiceModeLocked={isActive}
                inputSource={inputSource}
                microphoneInputLocked={isActive}
                midiInputLocked={isActive}
                recordingMode={recordingMode}
                recordingModeLocked={isActive || isPreparingCamera}
                recordingStatus={cameraStatusMessage}
                onPracticeModeChange={setPracticeMode}
                onInputSourceChange={setInputSource}
                onRecordingModeChange={(mode) => {
                  void changeRecordingMode(mode);
                }}
              />
            </SheetContent>
          </Sheet>

          <PracticeCompletionDialog
            open={isCompletionDialogOpen}
            outcome={completionOutcome}
            {...(practiceMode === 'STEP_BY_STEP'
              ? { sessionMode: 'STEP_BY_STEP' as const }
              : { sessionMode: 'CONTINUOUS_PLAY' as const, onViewSummary: handleViewSummary })}
            isLoading={localPractice.isFinalizingPerformance}
            onOpenChange={setIsCompletionDialogOpen}
            onRestart={handleRestart}
            onAdjustSection={range.isRangeScopeReady ? handleAdjustSelectedSection : undefined}
          />
        </>
      )}
    </>
  );
}
