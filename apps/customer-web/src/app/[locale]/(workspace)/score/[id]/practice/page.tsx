'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { usePracticeSource } from '@/hooks/practice/use-practice-source';
import { usePracticeReadyScoreContent } from '@/hooks/practice/use-practice-ready-score-content';
import { useLocalPractice } from '@/hooks/practice/use-local-practice';
import { usePracticeDeviceLease } from '@/hooks/practice/use-practice-device-lease';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
import { PracticeReadinessGate } from '@/components/practice/practice-readiness-gate';
import { practiceLocation } from '@/lib/practice/configuration/practice-location';
import { usePracticeRangeSelection } from '@/hooks/practice/use-practice-range-selection';
import { ClientOnly } from '@/components/client-only';
import { PracticeScoreViewer } from '@/components/practice/practice-score-viewer';
import { StepPracticeControls, ContinuousPracticeControls } from '@/components/practice/practice-controls';
import { PracticeCompletionDialog } from '@/components/practice/practice-completion-dialog';
import { PracticeFeedbackSettings } from '@/components/practice/practice-feedback-settings';
import { StepAnalysisInterruptionDialog } from '@/components/practice/step-analysis-interruption-dialog';
import { StepInfrastructureInterruptionDialog } from '@/components/practice/step-infrastructure-interruption-dialog';
import { AnalysisInterruptionDialog } from '@/components/practice/analysis-interruption-dialog';
import { ResourceInterruptionDialog } from '@/components/practice/resource-interruption-dialog';
import { PracticeStatus } from '@/components/practice/practice-status';
import { PracticeDeviceStatusPopover } from '@/components/practice/practice-device-status-popover';
import { practiceDeviceRequirements } from '@/lib/practice/device/device-contract';
import { PracticeSkipControl } from '@/components/practice/practice-skip-control';
import { ResourceLoadError } from '@/components/states';
import { ResourceLoading } from '@/components/loading';
import { ScoreSurface } from '@/components/score/score-surface';
import { WorkspaceAccessDenied } from '@/components/score/workspace-access-denied';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { resolvePracticeScope } from '@/lib/practice/kernel/scope';
import { projectPracticeMomentViews, type PracticeMomentView } from '@/lib/practice/score-view/moment-view';
import {
  evaluatePracticeInputCapabilities,
  getSelectedInputCapability,
} from '@/lib/practice/input-capability';
import type { PracticeCompletionOutcome } from '@/lib/practice/completion-outcome';

function CameraPreview({
  stream,
  label,
  status,
}: {
  stream: MediaStream;
  label: string;
  status: string | null;
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
      <div className="bg-white px-2 py-1 text-xs font-medium text-slate-700">{status ?? label}</div>
    </div>
  );
}

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  return <PracticeReadinessGate><PracticeWorkspace params={params} /></PracticeReadinessGate>;
}

function PracticeWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id } = resolvedParams;
  const t = useTranslations('practice');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const router = useRouter();

  // Mode and settings
  const workspace = usePracticeWorkspace();
  const practiceMode = workspace.profile.mode!;
  const inputSource = workspace.profile.inputSource!;
  const recordingMode = practiceMode === 'STEP_BY_STEP' ? 'OFF' : workspace.profile.continuous.recordingMode;
  const { tempoSelection, setTempoSelection, metronomeEnabled, setMetronomeEnabled, profile, updateProfile } = workspace;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);
  const [stepManuallyEnded, setStepManuallyEnded] = useState(false);
  const [stepRequiresSetup, setStepRequiresSetup] = useState(false);

  // Score details and assets
  const source = usePracticeSource(id);
  const { scoreQuery, artifactQuery, artifact } = source;
  const canEnterPractice = source.canPractice;
  const scoreCapabilities = scoreQuery.data?.data?.capabilities;
  const selectedRevisionId = source.revisionId ?? undefined;
  useEffect(() => {
    if (source.invalid) router.replace(practiceLocation(id, 'setup', source.revisionId));
  }, [source.invalid, source.revisionId, id, router]);

  const revisionQuery = usePracticeReadyScoreContent(
    id,
    selectedRevisionId,
    canEnterPractice && Boolean(selectedRevisionId)
  );
  const xmlContent = revisionQuery.data?.data?.content ?? null;

  // Range interaction projects canonical moment notation references.
  const expectedGroups: readonly PracticeMomentView[] = useMemo(
    () => artifact ? projectPracticeMomentViews(artifact) : [],
    [artifact]
  );

  const range = usePracticeRangeSelection(expectedGroups, workspace.scope, workspace.setScope);
  const { practiceScope, selectedRangeRenderNoteIds } = range;

  const resolvedScope = useMemo(() => {
    if (!artifact || expectedGroups.length === 0) return null;
    if (!practiceScope) return null;
    return resolvePracticeScope(artifact, practiceScope);
  }, [artifact, expectedGroups.length, practiceScope]);

  const scopeStartBeat = resolvedScope?.startBeat ?? 0;

  const device = usePracticeDeviceLease({ mode: practiceMode, inputSource, recordingMode: recordingMode ?? 'OFF' }, Boolean(artifact) && workspace.ready);
  const requiredDevices = practiceDeviceRequirements({ mode: practiceMode, inputSource, recordingMode: recordingMode ?? 'OFF' });
  const devicesReady = device.snapshot?.state === 'READY';
  const cameraPreviewStream = device.snapshot?.health.camera === 'HEALTHY' ? device.snapshot.roots.camera : null;
  const stepAutoArm = useRef<string | null>(null);

  // Local Practice orchestration
  const localPractice = useLocalPractice({
    artifact,
    mode: practiceMode,
    inputSource,
    scope: practiceScope,
    tempoSelection,
    metronomeEnabled,
    recordingMode: recordingMode ?? undefined,
    getDevices: device.borrow, observeDevices: device.observe,
    acquireInference: workspace.environment.acquireInference,
    onNaturalCompletion: snapshot => {
      if (snapshot.completionReason !== 'SCOPE_COMPLETED') return;
      setIsCompletionDialogOpen(true);
    },
  });
  const analysisIntervention = localPractice.mode === 'CONTINUOUS_PLAY' ? localPractice.analysisIntervention : null;
  const intervention = localPractice.mode === 'CONTINUOUS_PLAY' ? localPractice.resourceIntervention : null;

  const handleMetronomeEnabledChange = useCallback(
    (enabled: boolean) => {
      setMetronomeEnabled(enabled);
      localPractice.setMetronomeEnabled(enabled);
    },
    [localPractice, setMetronomeEnabled]
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
    workspace.ready && devicesReady &&
    !isResourceLoading &&
    !loadError;

  const goToPracticeSetup = () => {
    setIsSettingsOpen(false);
    router.push(practiceLocation(id, 'setup', selectedRevisionId));
  };
  const handleRestart = async () => {
    setIsCompletionDialogOpen(false);
    if (!workspace.ready || !devicesReady) { goToPracticeSetup(); return; }
    setStepManuallyEnded(false); setStepRequiresSetup(false);
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
  useEffect(() => {
    if (!workspace.ready && workspace.readiness.status !== 'READY' && !isActive && !isCompletionDialogOpen) {
      router.replace(practiceLocation(id, 'setup', selectedRevisionId));
    }
  }, [workspace.ready, workspace.readiness.status, isActive, isCompletionDialogOpen, router, id, selectedRevisionId]);
  const inputCapabilities = useMemo(() => evaluatePracticeInputCapabilities(), []);
  const selectedInputCapability = useMemo(
    () => getSelectedInputCapability(inputSource, inputCapabilities, practiceMode),
    [inputCapabilities, inputSource, practiceMode]
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

  const stepBusy = localPractice.mode === 'STEP_BY_STEP' && ['CAPTURING', 'ANALYZING'].includes(localPractice.stepInteractionPhase ?? '');
  const stepKey = JSON.stringify([selectedRevisionId, practiceScope, tempoSelection]);
  const handleEnd = async () => { stepAutoArm.current = stepKey; setStepManuallyEnded(true); setStepRequiresSetup(false); await localPractice.abandon(); };
  const handleStepTerminalEnd = async () => {
    stepAutoArm.current = stepKey; setStepManuallyEnded(true); setStepRequiresSetup(true);
    await localPractice.abandon();
  };
  useEffect(() => {
    if (practiceMode !== 'STEP_BY_STEP') return;
    if (range.isSelecting) {
      if (stepAutoArm.current !== null) { stepAutoArm.current = null; void localPractice.abandon(); }
      return;
    }
    if (stepRequiresSetup || stepManuallyEnded || !canPreparePractice || isCompletionDialogOpen || stepAutoArm.current === stepKey) return;
    stepAutoArm.current = stepKey;
    void localPractice.restart();
  }, [practiceMode, stepRequiresSetup, stepManuallyEnded, canPreparePractice, range.isSelecting, isCompletionDialogOpen, stepKey, localPractice]);

  const controlSurfaceProps = {
      isLoading: isLoadingXml,
      isPreparingSession: localPractice.inputState === 'STARTING' || !device.snapshot || device.snapshot.state === 'OPENING',
      canPrepareSession: canPreparePractice,
      selectedInputCapability,
      selectedInputSupported: selectedInputCapability.supported,
      rangeSelectionActive: range.rangeSelectionActive,
      canSelectRange: isStepMode ? !stepBusy : !isActive,
      tempoSelection,
      scoreTempoSegments: artifact?.scoreTempoSegments,
      scopeStartBeat,
      tempoLocked: isStepMode ? stepBusy : isActive,
      onTempoSelectionChange: setTempoSelection,
      metronomeEnabled,
      onMetronomeEnabledChange: handleMetronomeEnabledChange,
      onStart: () => { stepAutoArm.current = stepKey; setStepManuallyEnded(false); setStepRequiresSetup(false); void localPractice.start(); },
      onEnd: () => { void handleEnd(); },
      onOpenSettings: () => setIsSettingsOpen(true),
      recordingSeconds: localPractice.recordingIndicator,
      onToggleRangeSelection: range.toggleSelection,
  };
  const practiceControls = localPractice.mode === 'STEP_BY_STEP'
    ? <StepPracticeControls {...controlSurfaceProps} lifecycle={localPractice.lifecycle} showContinue={stepManuallyEnded && !stepRequiresSetup && localPractice.lifecycle === 'IDLE' && !localPractice.inputError && canPreparePractice} />
    : <ContinuousPracticeControls {...controlSurfaceProps} lifecycle={localPractice.lifecycle}
        onPause={() => void localPractice.pause()} onResume={() => void localPractice.resume()} />;

  const practiceSessionStatus = (
    <PracticeStatus
      className="border-0 bg-transparent px-0 py-0 shadow-none"
      deviceIssue={device.snapshot?.issue ?? null}
      deviceControls={requiredDevices.map(resource => <PracticeDeviceStatusPopover key={resource} resource={resource}
        health={device.snapshot?.health[resource] ?? null}
        issue={device.snapshot?.issue?.resource === resource ? device.snapshot.issue : null} />)}
      lifecycle={localPractice.lifecycle}
      inputState={localPractice.inputState}
      inputError={localPractice.inputError}
      resourceImpact={intervention?.impact ?? null}
      inputSource={inputSource}
      selectedInputCapability={selectedInputCapability}
      rangePrompt={rangeSelectionPrompt}
      sessionMode={practiceMode}
      performanceClock={localPractice.performanceClock}
      stepInteractionPhase={localPractice.mode === 'STEP_BY_STEP' ? localPractice.stepInteractionPhase : null}
      pendingPostVerdict={localPractice.mode === 'STEP_BY_STEP' ? localPractice.pendingPostVerdict : null}
    />
  );

  const renderFrame = (children: React.ReactNode) => (
    <ScoreSurface>
      <div className="w-full">
        <nav className="flex h-11 items-center px-4 sm:px-6" aria-label={t('practiceSetup')}>
          <button type="button" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900" onClick={goToPracticeSetup}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('practiceSetup')}
          </button>
        </nav>
        {children}
      </div>
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
                    showContinuousFeedback={profile.continuous.liveFeedbackEnabled}
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
                  <CameraPreview stream={cameraPreviewStream} label={t('settingCameraPreview')} status={intervention ? t('recordingInterrupted') : null} />
                ) : null}

                <footer className="absolute bottom-0 left-0 right-0 z-20 flex min-h-20 items-center justify-between border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6">
                  <div className="flex w-full items-center justify-between">
                    {practiceControls}
                  </div>
                </footer>
              </div>
            </main>
          </div>

          {<Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <SheetContent side="right" className="w-full p-0 sm:max-w-md">
              <SheetTitle className="sr-only">{t('settingsTitle')}</SheetTitle>
              <SheetDescription className="sr-only">{t('settingsSubtitle')}</SheetDescription>
              {!isStepMode && <PracticeFeedbackSettings enabled={profile.continuous.liveFeedbackEnabled}
                onChange={enabled => updateProfile({ ...profile, continuous: { ...profile.continuous, liveFeedbackEnabled: enabled } })} />}
              <button type="button" className="m-5 rounded px-2 py-1 text-sm text-slate-600 underline disabled:opacity-50" disabled={isStepMode ? stepBusy : isActive}
                onClick={goToPracticeSetup}>{t('setupChangeConfiguration')}</button>
            </SheetContent>
          </Sheet>}

          {localPractice.mode === 'STEP_BY_STEP' && localPractice.analysisIntervention && <StepAnalysisInterruptionDialog onEnd={handleStepTerminalEnd} />}
          {localPractice.mode === 'STEP_BY_STEP' && localPractice.infrastructureIntervention && <StepInfrastructureInterruptionDialog onEnd={handleStepTerminalEnd} />}
          {localPractice.mode === 'CONTINUOUS_PLAY' && analysisIntervention && <AnalysisInterruptionDialog
            onContinueWithoutAnalysis={localPractice.continueWithoutAnalysis}
            onEnd={handleEnd} />}
          {localPractice.mode === 'CONTINUOUS_PLAY' && !analysisIntervention && intervention && <ResourceInterruptionDialog
            intervention={intervention} onContinueWithout={localPractice.continueWithoutRecording}
            onContinue={() => { localPractice.continueAfterRecovery(); }}
            onEnd={handleEnd} />}
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
