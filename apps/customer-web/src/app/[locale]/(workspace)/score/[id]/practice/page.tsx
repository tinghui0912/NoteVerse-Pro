'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { useScoreDetail } from '@/hooks/queries/use-score-queries';
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { usePracticeScoreArtifact } from '@/hooks/practice/use-practice-score-artifact';
import { useLocalPractice } from '@/hooks/practice/use-local-practice';
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
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import {
  resolvePracticeScope,
  type ExpectedPracticeGroup,
  type PracticeInputSource,
  type PracticeMode,
  type PracticeScope,
} from '@/lib/practice/local-core/artifact';
import type { PracticeTempoSelection } from '@/lib/practice/local-core/practice-tempo';
import {
  evaluatePracticeInputCapabilities,
  getSelectedInputCapability,
} from '@/lib/practice/input-capability';
import {
  fullPiecePracticeRangeSelection,
  groupById,
  practiceGroupsInRangeSelection,
  practiceScopeFromRangeSelection,
  selectedPracticeRangeSelection,
  targetForRenderNoteId,
  transitionPracticeRangeSelection,
  type PracticeRangeSelection,
} from '@/lib/practice/range-selection';
import type { PracticeCompletionOutcome } from '@/lib/practice/completion-outcome';

function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

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
  const searchParams = useSearchParams();

  // Mode and settings
  const [practiceMode, setPracticeMode] = useState<PracticeMode>('STEP_BY_STEP');
  const [inputSource, setInputSource] = useState<PracticeInputSource>('MICROPHONE');
  const [tempoSelection, setTempoSelection] = useState<PracticeTempoSelection>({ mode: 'SCORE' });
  const [metronomeEnabled, setMetronomeEnabled] = useState(false);
  const [cameraRecordingEnabled, setCameraRecordingEnabled] = useState(false);
  const [cameraPreviewStream, setCameraPreviewStream] = useState<MediaStream | null>(null);
  const [cameraStatusMessage, setCameraStatusMessage] = useState<string | null>(null);
  const [isPreparingCamera, setIsPreparingCamera] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);
  const cameraRequestGenerationRef = useRef(0);
  const [rangeSelection, setRangeSelection] = useState<PracticeRangeSelection>(
    fullPiecePracticeRangeSelection
  );
  const [isSelectingRange, setIsSelectingRange] = useState(false);

  const hasCompletedRange =
    rangeSelection.kind === 'SELECTED_RANGE' &&
    Boolean(rangeSelection.startGroupId && rangeSelection.endGroupId);

  // Score details and assets
  const scoreQuery = useScoreDetail(id);
  const scoreCapabilities = scoreQuery.data?.data?.capabilities;
  const canEnterPractice = scoreCapabilities?.can_practice !== false;
  const selectedRevisionId =
    searchParams.get('practiceRevisionId') ?? scoreQuery.data?.data?.head_revision_id ?? undefined;

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

  // Range scope calculation from artifact
  const expectedGroups: readonly ExpectedPracticeGroup[] = useMemo(
    () => artifact?.expectedPracticeGroups ?? [],
    [artifact]
  );

  const selectedRangeScope: PracticeScope | null = useMemo(
    () => practiceScopeFromRangeSelection(rangeSelection, expectedGroups),
    [expectedGroups, rangeSelection]
  );

  const resolvedScope = useMemo(() => {
    if (!artifact || expectedGroups.length === 0) return null;
    return resolvePracticeScope(artifact, selectedRangeScope ?? {});
  }, [artifact, expectedGroups.length, selectedRangeScope]);

  const scopeStartBeat = resolvedScope?.startBeat ?? 0;

  const pendingStartGroup = useMemo(
    () =>
      rangeSelection.kind === 'SELECTED_RANGE' && rangeSelection.startGroupId
        ? groupById(expectedGroups, rangeSelection.startGroupId)
        : null,
    [expectedGroups, rangeSelection]
  );

  const selectedRangeGroups = useMemo(
    () => practiceGroupsInRangeSelection(rangeSelection, expectedGroups),
    [expectedGroups, rangeSelection]
  );

  const selectedRangeRenderNoteIds = useMemo(() => {
    if (
      rangeSelection.kind === 'SELECTED_RANGE' &&
      rangeSelection.startGroupId &&
      !rangeSelection.endGroupId
    ) {
      return pendingStartGroup ? pendingStartGroup.renderNoteIds : [];
    }
    return selectedRangeGroups.flatMap((group) => group.renderNoteIds);
  }, [pendingStartGroup, rangeSelection, selectedRangeGroups]);

  const releaseCameraPreview = useCallback(() => {
    cameraRequestGenerationRef.current += 1;
    setCameraPreviewStream((current) => {
      stopMediaStream(current);
      return null;
    });
    setCameraRecordingEnabled(false);
    setIsPreparingCamera(false);
  }, []);

  const handleCameraRecordingEnabledChange = useCallback(
    async (enabled: boolean) => {
      if (!enabled) {
        releaseCameraPreview();
        setCameraStatusMessage(null);
        return;
      }
      if (practiceMode !== 'CONTINUOUS_PLAY') {
        setCameraStatusMessage(t('settingCameraContinuousOnly'));
        return;
      }
      const mediaDevices = globalThis.navigator?.mediaDevices;
      if (!mediaDevices?.getUserMedia) {
        setCameraStatusMessage(t('settingCameraUnsupported'));
        return;
      }

      setIsPreparingCamera(true);
      setCameraStatusMessage(t('settingCameraPreparing'));
      const requestGeneration = cameraRequestGenerationRef.current + 1;
      cameraRequestGenerationRef.current = requestGeneration;
      try {
        const stream = await mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
          },
          audio:
            inputSource === 'MIDI'
              ? {
                  echoCancellation: false,
                  noiseSuppression: false,
                  autoGainControl: false,
                }
              : false,
        });
        const isStillCurrent =
          cameraRequestGenerationRef.current === requestGeneration &&
          practiceMode === 'CONTINUOUS_PLAY';
        if (!isStillCurrent) {
          stopMediaStream(stream);
          return;
        }
        const hasVideo = stream.getVideoTracks().some((track) => track.readyState === 'live');
        const hasAudio =
          inputSource === 'MICROPHONE' ||
          stream.getAudioTracks().some((track) => track.readyState === 'live');
        if (!hasVideo || !hasAudio) {
          stopMediaStream(stream);
          setCameraStatusMessage(
            hasVideo ? t('settingCameraAudioMissing') : t('settingCameraVideoMissing')
          );
          return;
        }
        setCameraPreviewStream((current) => {
          stopMediaStream(current);
          return stream;
        });
        setCameraRecordingEnabled(true);
        setCameraStatusMessage(t('settingCameraReady'));
      } catch (error) {
        if (cameraRequestGenerationRef.current !== requestGeneration) {
          return;
        }
        const name = error instanceof DOMException ? error.name : '';
        setCameraStatusMessage(
          name === 'NotAllowedError' || name === 'PermissionDeniedError'
            ? t('settingCameraPermissionDenied')
            : t('settingCameraUnavailable')
        );
        setCameraRecordingEnabled(false);
      } finally {
        if (cameraRequestGenerationRef.current === requestGeneration) {
          setIsPreparingCamera(false);
        }
      }
    },
    [inputSource, practiceMode, releaseCameraPreview, t]
  );

  useEffect(() => {
    if (practiceMode === 'STEP_BY_STEP') {
      releaseCameraPreview();
      setCameraStatusMessage(null);
    }
  }, [practiceMode, releaseCameraPreview]);

  useEffect(() => {
    releaseCameraPreview();
    setCameraStatusMessage(null);
  }, [inputSource, releaseCameraPreview]);

  useEffect(() => {
    return () => {
      cameraRequestGenerationRef.current += 1;
      stopMediaStream(cameraPreviewStream);
    };
  }, [cameraPreviewStream]);

  // Local Practice orchestration
  const localPractice = useLocalPractice({
    artifact,
    mode: practiceMode,
    inputSource,
    scope: selectedRangeScope,
    tempoSelection,
    metronomeEnabled,
    cameraRecordingEnabled: practiceMode === 'CONTINUOUS_PLAY' && cameraRecordingEnabled,
    cameraMediaStream: cameraPreviewStream,
    onCompletion: () => {
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
    !isResourceLoading &&
    !loadError;

  const handleToggleRangeSelection = () => {
    if (hasCompletedRange || isSelectingRange) {
      // Clear current range or cancel in-progress selection, restoring full piece
      setIsSelectingRange(false);
      setRangeSelection(fullPiecePracticeRangeSelection);
    } else {
      // Begin selecting start note
      setIsSelectingRange(true);
      setRangeSelection(selectedPracticeRangeSelection());
    }
  };

  const handleRenderNoteClick = useCallback(
    (renderNoteId: string) => {
      if (!isSelectingRange) {
        return;
      }
      const targetGroup = targetForRenderNoteId(expectedGroups, renderNoteId);
      if (!targetGroup) {
        return;
      }
      const { nextSelection, completed } = transitionPracticeRangeSelection(
        rangeSelection,
        expectedGroups,
        targetGroup.groupId
      );
      setRangeSelection(nextSelection);
      if (completed) {
        setIsSelectingRange(false);
      }
    },
    [expectedGroups, isSelectingRange, rangeSelection]
  );

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
    void localPractice.finish();
    setIsSelectingRange(true);
    setRangeSelection(selectedPracticeRangeSelection());
  };

  const completionOutcome: PracticeCompletionOutcome = useMemo(() => {
    if (selectedRangeScope) {
      return {
        kind: 'selected-section',
      };
    }
    return {
      kind: practiceMode === 'CONTINUOUS_PLAY' ? 'full-piece-performance' : 'full-piece-learning',
    };
  }, [selectedRangeScope, practiceMode]);

  const isStepMode = practiceMode === 'STEP_BY_STEP';
  const isActive =
    localPractice.lifecycle === 'ACTIVE' ||
    localPractice.lifecycle === 'PAUSED';

  const inputCapabilities = useMemo(() => evaluatePracticeInputCapabilities(), []);
  const selectedInputCapability = useMemo(
    () => getSelectedInputCapability(inputSource, inputCapabilities),
    [inputCapabilities, inputSource]
  );

  const rangeSelectionPrompt = useMemo(() => {
    if (!isSelectingRange) {
      if (
        hasCompletedRange &&
        selectedRangeGroups.length > 0
      ) {
        const startMeasure = selectedRangeGroups[0]?.measureNumbers[0];
        const endMeasure = selectedRangeGroups.at(-1)?.measureNumbers.at(-1);
        const rangeText =
          startMeasure && endMeasure && startMeasure !== endMeasure
            ? `${startMeasure}–${endMeasure}`
            : (startMeasure ?? '');
        return t('sectionSelectedRange', { range: rangeText });
      }
      return null;
    }
    if (
      rangeSelection.kind === 'FULL_PIECE' ||
      !rangeSelection.startGroupId ||
      Boolean(rangeSelection.startGroupId && rangeSelection.endGroupId)
    ) {
      return t('sectionSelectingStart');
    }
    return t('sectionSelectingEnd');
  }, [hasCompletedRange, isSelectingRange, rangeSelection, selectedRangeGroups, t]);

  const practiceControls = (
    <PracticeControls
      lifecycle={localPractice.lifecycle}
      isLoading={isLoadingXml}
      isPreparingSession={localPractice.inputState === 'STARTING'}
      canPrepareSession={canPreparePractice}
      selectedInputCapability={selectedInputCapability}
      selectedInputSupported={selectedInputCapability.supported}
      rangeSelectionActive={isSelectingRange || hasCompletedRange}
      canSelectRange={!isActive}
      tempoSelection={tempoSelection}
      scoreTempoSegments={artifact?.scoreTempoSegments}
      scopeStartBeat={scopeStartBeat}
      tempoLocked={isActive}
      onTempoSelectionChange={setTempoSelection}
      metronomeEnabled={metronomeEnabled}
      onMetronomeEnabledChange={handleMetronomeEnabledChange}
      onStart={() => void localPractice.start()}
      onPause={() => void localPractice.pause()}
      onResume={() => void localPractice.resume()}
      onFinish={() => {
        void localPractice.finish();
        setIsCompletionDialogOpen(true);
      }}
      onOpenSettings={() => setIsSettingsOpen(true)}
      onToggleRangeSelection={handleToggleRangeSelection}
    />
  );

  const practiceSessionStatus = (
    <PracticeSessionStatus
      className="border-0 bg-transparent px-0 py-0 shadow-none"
      lifecycle={localPractice.lifecycle}
      inputState={localPractice.inputState}
      inputError={localPractice.inputError}
      inputSource={inputSource}
      selectedInputCapability={selectedInputCapability}
      rangePrompt={rangeSelectionPrompt}
      isLoading={isLoadingXml}
      sessionMode={practiceMode}
      practiceTime={localPractice.elapsedSeconds}
      performanceClock={localPractice.performanceClock}
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
                    performanceScopeBeats={
                      localPractice.performanceClock
                        ? {
                            startBeat: localPractice.performanceClock.scopeStartBeat,
                            terminalBeat: localPractice.performanceClock.scopeTerminalBeat,
                          }
                        : null
                    }
                    selectedRangeRenderNoteIds={selectedRangeRenderNoteIds}
                    onRenderNoteClick={isSelectingRange ? handleRenderNoteClick : undefined}
                  />
                </ClientOnly>

                {isStepMode && isActive ? (
                  <div className="pointer-events-none absolute bottom-24 right-6 z-30">
                    <PracticeSkipControl
                      visible={true}
                      disabled={localPractice.lifecycle === 'PAUSED'}
                      onSkip={localPractice.skip}
                    />
                  </div>
                ) : null}

                {!isStepMode && cameraRecordingEnabled && cameraPreviewStream ? (
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
                microphoneCapability={inputCapabilities.microphone}
                midiCapability={inputCapabilities.midi}
                practiceMode={practiceMode}
                practiceModeLocked={isActive}
                inputSource={inputSource}
                microphoneInputLocked={isActive}
                midiInputLocked={isActive}
                cameraRecordingEnabled={cameraRecordingEnabled}
                cameraRecordingLocked={isActive || isPreparingCamera}
                cameraRecordingStatus={cameraStatusMessage}
                onPracticeModeChange={setPracticeMode}
                onInputSourceChange={setInputSource}
                onCameraRecordingEnabledChange={(enabled) => {
                  void handleCameraRecordingEnabledChange(enabled);
                }}
              />
            </SheetContent>
          </Sheet>

          <PracticeCompletionDialog
            open={isCompletionDialogOpen}
            outcome={completionOutcome}
            sessionMode={practiceMode}
            isLoading={localPractice.isFinalizingRecording}
            onOpenChange={setIsCompletionDialogOpen}
            onRestart={handleRestart}
            onAdjustSection={selectedRangeScope ? handleAdjustSelectedSection : undefined}
            onViewSummary={handleViewSummary}
          />
        </>
      )}
    </>
  );
}
