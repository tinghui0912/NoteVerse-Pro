'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { useSearchParams } from 'next/navigation';
import { createPracticePreparationKey } from '@/lib/practice/preparation/preparation-key';
import { usePracticeActivityCompletion } from '@/hooks/practice/use-practice-activity-completion';
import { usePracticeExecution } from '@/hooks/practice/use-practice-execution';
import { usePracticeResourceBinding } from '@/hooks/practice/use-practice-resource-binding';
import { usePracticeWorkspace } from '@/contexts/practice-workspace-context';
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
import { PracticeSkipControl } from '@/components/practice/practice-skip-control';
import { ScoreSurface } from '@/components/score/score-surface';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { planPractice } from '@/lib/practice/planning/practice-plan';
import type { PracticeIntent } from '@/lib/practice/planning/intent';
import { projectPracticeMomentViews, type PracticeMomentView } from '@/lib/practice/score-view/moment-view';
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
  return <PracticeWorkspace params={params} />;
}

function PracticeWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id } = resolvedParams;
  const t = useTranslations('practice');
  const router = useRouter();

  // Mode and settings
  const workspace = usePracticeWorkspace();
  const practiceMode = workspace.configuration?.mode ?? null;
  const inputSource = workspace.configuration?.inputSource ?? null;
  const recordingMode = practiceMode === 'STEP_BY_STEP' ? 'OFF' : workspace.profile.continuous.recordingMode;
  const { tempoSelection, setTempoSelection, metronomeEnabled, setMetronomeEnabled, profile, updateProfile } = workspace;
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);

  const selectedRevisionId = useSearchParams().get('practiceRevisionId') ?? undefined;
  const configuration = workspace.configuration;
  const preparationMode = configuration?.mode, preparationInput = configuration?.inputSource, preparationRecording = configuration?.recordingMode;
  const expectedKey = selectedRevisionId && preparationMode && preparationInput && preparationRecording
    ? createPracticePreparationKey(id, selectedRevisionId, { mode: preparationMode, inputSource: preparationInput, recordingMode: preparationRecording }) : null;
  const { enterPractice, preparedFor, hydrated } = workspace;
  const prepared = preparedFor(expectedKey);
  const matching = prepared !== null;
  const bundle = prepared?.bundle ?? null;
  useLayoutEffect(() => {
    if (!hydrated) return;
    const target = selectedRevisionId && preparationMode && preparationInput && preparationRecording
      ? createPracticePreparationKey(id, selectedRevisionId, { mode: preparationMode, inputSource: preparationInput, recordingMode: preparationRecording }) : null;
    if (!enterPractice(target)) router.replace(practiceLocation(id, 'setup', selectedRevisionId));
  }, [id, selectedRevisionId, preparationMode, preparationInput, preparationRecording, hydrated, enterPractice, router]);
  const artifact = bundle?.artifact ?? null;
  const xmlContent = bundle?.musicXml ?? null;

  // Range interaction projects canonical moment notation references.
  const expectedGroups: readonly PracticeMomentView[] = useMemo(
    () => artifact ? projectPracticeMomentViews(artifact) : [],
    [artifact]
  );

  const range = usePracticeRangeSelection(expectedGroups, workspace.scope, workspace.setScope);
  const { practiceScope, selectedRangeRenderNoteIds } = range;


  const intent = useMemo<PracticeIntent | null>(() => {
    if (!configuration || !practiceScope) return null;
    return Object.freeze({ mode: configuration.mode, inputSource: configuration.inputSource,
      recordingMode: configuration.recordingMode, scope: Object.freeze({ ...practiceScope }),
      tempoSelection: Object.freeze({ ...tempoSelection }), metronomeEnabled }) as PracticeIntent;
  }, [configuration, practiceScope, tempoSelection, metronomeEnabled]);
  const plan = useMemo(() => bundle && intent
    ? planPractice(bundle, intent) : null,
    [bundle, intent]);

  const device = usePracticeResourceBinding(matching ? prepared!.binding : null);
  const acousticState = useSyncExternalStore(workspace.environment.subscribeAcoustic, workspace.environment.acousticState, workspace.environment.acousticState);
  const requiredDevices = workspace.resourcePlan?.liveRoots ?? [];
  const devicesReady = device.snapshot?.state === 'READY';
  const cameraPreviewStream = device.snapshot?.health.camera === 'HEALTHY' ? device.snapshot.roots.camera : null;

  // Capability preflight belongs to Setup; this projects the admitted selected input only.
  const selectedInputCapability = matching ? { supported: true as const, status: 'AVAILABLE' as const } : undefined;
  const canPreparePractice = Boolean(plan) && !range.isIncomplete && !range.isSelecting
    && matching && devicesReady && (plan?.resources.analysis.kind !== 'ACOUSTIC' || acousticState === 'READY_IDLE');
  const recordActivity = usePracticeActivityCompletion();

  // Local Practice orchestration
  const execution = usePracticeExecution({
    plan, admitted: canPreparePractice, compositionId: `${id}:${selectedRevisionId ?? ''}`,
    borrowRoots: device.borrow, rootHealth: device.rootHealth,
    acquireInference: workspace.environment.acquireInference,
    onNaturalCompletion: snapshot => {
      if (snapshot.completionReason !== 'SCOPE_COMPLETED') return;
      setIsCompletionDialogOpen(true);
      recordActivity(snapshot);
    },
  });
  const stepCommands = execution.mode === 'STEP_BY_STEP' && execution.modeCommands?.mode === 'STEP_BY_STEP' ? execution.modeCommands : null;
  const continuousCommands = execution.mode === 'CONTINUOUS_PLAY' && execution.modeCommands?.mode === 'CONTINUOUS_PLAY' ? execution.modeCommands : null;
  const displayPlan = execution.executedPlan ?? plan;
  const scopeStartTick = displayPlan?.scope.startTick ?? 0;
  const displayRangeRenderNoteIds = execution.executedPlan?.scope.kind === 'RANGE'
    ? expectedGroups.slice(execution.executedPlan.scope.startIndex, execution.executedPlan.scope.endIndex + 1).flatMap(group => group.renderNoteIds)
    : execution.executedPlan ? [] : selectedRangeRenderNoteIds;
  const analysisIntervention = execution.mode === 'CONTINUOUS_PLAY' ? execution.analysisIntervention : null;
  const intervention = execution.mode === 'CONTINUOUS_PLAY' ? execution.resourceIntervention : null;

  const handleMetronomeEnabledChange = useCallback(
    (enabled: boolean) => {
      setMetronomeEnabled(enabled);
      if (stepCommands) stepCommands.setMetronomeEnabled(enabled);
      else continuousCommands?.setMetronomeEnabled(enabled);
    },
    [stepCommands, continuousCommands, setMetronomeEnabled]
  );

  const goToPracticeSetup = () => {
    setIsSettingsOpen(false);
    workspace.enterSetup(expectedKey);
    router.push(practiceLocation(id, 'setup', selectedRevisionId));
  };
  const handleRetry = async () => {
    setIsCompletionDialogOpen(false);
    if (!canPreparePractice) return;
    await execution.retry();
  };

  const handleViewSummary = useCallback(() => {
    setIsCompletionDialogOpen(false);
    if (!execution.completion) throw new Error('Continuous completion required for Review.');
    if (!expectedKey) throw new Error('Prepared Practice identity required for Review.');
    workspace.handoffToReview(execution.completion, expectedKey);
    router.push(`/score/${id}/practice/review`);
  }, [id, router, workspace, execution.completion, expectedKey]);

  const handleAdjustSelectedSection = async () => {
    setIsCompletionDialogOpen(false);
    await execution.end(); range.beginSelection();
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
    execution.inputState === 'STARTING' ||
    execution.lifecycle === 'ACTIVE' ||
    execution.lifecycle === 'PAUSED' || execution.lifecycle === 'FINALIZING'
    || execution.lifecycle === 'ERROR' && Boolean(execution.executedPlan);



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

  const handleEnd = async () => { await execution.end(); };
  const controlSurfaceProps = {
      isLoading: false,
      isPreparingSession: execution.inputState === 'STARTING',
      canPrepareSession: canPreparePractice && execution.canStart,
      selectedInputCapability,
      selectedInputSupported: selectedInputCapability?.supported,
      rangeSelectionActive: range.rangeSelectionActive,
      canSelectRange: !isActive,
      tempoSelection: displayPlan?.tempoPlan.selection ?? tempoSelection,
      scoreTempoSegments: artifact?.scoreTempoSegments,
      scopeStartTick,
      tempoLocked: isActive,
      onTempoSelectionChange: setTempoSelection,
      metronomeEnabled,
      onMetronomeEnabledChange: handleMetronomeEnabledChange,
      onStart: () => { void execution.start(); },
      onEnd: () => { void handleEnd(); },
      onOpenSettings: () => setIsSettingsOpen(true),
      recordingSeconds: execution.recordingIndicator,
      onToggleRangeSelection: range.toggleSelection,
  };
  const practiceControls = execution.mode === 'STEP_BY_STEP'
    ? <StepPracticeControls {...controlSurfaceProps} lifecycle={execution.lifecycle} />
    : <ContinuousPracticeControls {...controlSurfaceProps} lifecycle={execution.lifecycle}
        onPause={() => void continuousCommands?.pause()} onResume={() => void continuousCommands?.resume()} />;

  const practiceSessionStatus = practiceMode && inputSource ? (
    <PracticeStatus
      className="border-0 bg-transparent px-0 py-0 shadow-none"
      deviceIssue={device.snapshot?.issue ?? null}
      deviceControls={requiredDevices.map(resource => <PracticeDeviceStatusPopover key={resource} resource={resource}
        health={device.snapshot?.health[resource] ?? null}
        issue={device.snapshot?.issue?.resource === resource ? device.snapshot.issue : null} />)}
      lifecycle={execution.lifecycle}
      inputState={execution.inputState}
      inputError={execution.inputError}
      resourceImpact={intervention?.impact ?? null}
      inputSource={inputSource}
      selectedInputCapability={selectedInputCapability}
      rangePrompt={rangeSelectionPrompt}
      sessionMode={practiceMode}
      performanceClock={execution.performanceClock}
      stepInteractionPhase={execution.mode === 'STEP_BY_STEP' ? execution.stepInteractionPhase : null}
      pendingPostVerdict={execution.mode === 'STEP_BY_STEP' ? execution.pendingPostVerdict : null}
    />
  ) : null;

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

  if (!configuration || !workspace.hydrated || !matching) {
    return renderFrame(<p role="status" className="p-6">{t('setupRequired')}</p>);
  }

  return renderFrame(
    <>
          <div className="min-h-[calc(100vh-4rem)] xl:flex xl:h-[calc(100dvh-4rem)] xl:min-h-[38rem] xl:flex-col">
            <main className="min-w-0 xl:flex xl:h-full xl:min-h-0 xl:flex-1 xl:flex-col">
              <div className="relative flex min-h-[38rem] flex-col pb-28 xl:h-full xl:min-h-0 xl:flex-1">
                <ClientOnly>
                  <PracticeScoreViewer artifact={artifact}
                    className="rounded-none border-0 shadow-none xl:min-h-0 xl:flex-1"
                    sessionStatus={practiceSessionStatus}
                    xmlContent={xmlContent}
                    isLoadingXml={false}
                    lifecycle={execution.lifecycle}
                    sessionMode={configuration.mode}
                    activeStepGroup={execution.activeStepGroup}
                    performanceScoreTick={execution.performanceClock?.scoreTick ?? null}
                    performanceEvaluation={execution.performanceEvaluation}
                    showContinuousFeedback={profile.continuous.liveFeedbackEnabled}
                    performanceScope={
                      execution.performanceClock
                        ? range.hasRangeSelection
                          ? {
                              kind: 'RANGE' as const,
                              startTick: execution.performanceClock.scopeStartTick,
                              terminalTick: execution.performanceClock.scopeTerminalTick,
                              allowedNoteIds: displayRangeRenderNoteIds,
                            }
                          : {
                              kind: 'FULL' as const,
                              startTick: execution.performanceClock.scopeStartTick,
                              terminalTick: execution.performanceClock.scopeTerminalTick,
                            }
                        : null
                    }
                    selectedRangeRenderNoteIds={displayRangeRenderNoteIds}
                    onRenderNoteClick={!isActive && range.isSelecting ? range.selectRenderNote : undefined}
                  />
                </ClientOnly>

                {execution.mode === 'STEP_BY_STEP' && isActive ? (
                  <div className="pointer-events-none absolute bottom-24 right-6 z-30">
                    <PracticeSkipControl
                      visible={true}
                      disabled={!execution.canAcceptAttempt}
                      onSkip={() => stepCommands?.skip()}
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
              <button type="button" className="m-5 rounded px-2 py-1 text-sm text-slate-600 underline disabled:opacity-50" disabled={isActive}
                onClick={goToPracticeSetup}>{t('setupChangeConfiguration')}</button>
            </SheetContent>
          </Sheet>}

          {execution.mode === 'STEP_BY_STEP' && execution.analysisIntervention && <StepAnalysisInterruptionDialog onEnd={handleEnd} />}
          {execution.mode === 'STEP_BY_STEP' && execution.infrastructureIntervention && <StepInfrastructureInterruptionDialog onEnd={handleEnd} />}
          {execution.mode === 'CONTINUOUS_PLAY' && analysisIntervention && <AnalysisInterruptionDialog
            onContinueWithoutAnalysis={() => continuousCommands?.continueWithoutAnalysis() ?? Promise.resolve()}
            onEnd={handleEnd} />}
          {execution.mode === 'CONTINUOUS_PLAY' && !analysisIntervention && intervention && <ResourceInterruptionDialog
            intervention={intervention} onContinueWithout={() => continuousCommands?.continueWithoutRecording()}
            onContinue={() => { continuousCommands?.continueAfterRecovery(); }}
            onEnd={handleEnd} />}
          <PracticeCompletionDialog
            open={isCompletionDialogOpen}
            outcome={completionOutcome}
            {...(practiceMode === 'STEP_BY_STEP'
              ? { sessionMode: 'STEP_BY_STEP' as const }
              : { sessionMode: 'CONTINUOUS_PLAY' as const, onViewSummary: handleViewSummary })}
            isLoading={execution.lifecycle === 'FINALIZING'}
            onOpenChange={setIsCompletionDialogOpen}
            onRetry={handleRetry}
            onAdjustSection={range.isRangeScopeReady ? handleAdjustSelectedSection : undefined}
          />
    </>
  );
}
