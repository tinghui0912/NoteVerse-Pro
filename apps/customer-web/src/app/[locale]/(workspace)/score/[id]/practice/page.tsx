'use client';

import React, { useCallback, useMemo, useState } from 'react';
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
  fullPiecePracticeRangeSelection,
  practiceGroupsInRangeSelection,
  practiceScopeFromRangeSelection,
  selectPracticeRangeTarget,
  selectedPracticeRangeSelection,
  targetForRenderNoteId,
  type PracticeRangeSelection,
} from '@/lib/practice/range-selection';
import type { PracticeCompletionOutcome } from '@/lib/practice/completion-outcome';

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);
  const [rangeSelection, setRangeSelection] = useState<PracticeRangeSelection>(
    fullPiecePracticeRangeSelection
  );
  const [isRangeSelectionMode, setIsRangeSelectionMode] = useState(false);

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

  const selectedRangeGroups = useMemo(
    () => practiceGroupsInRangeSelection(rangeSelection, expectedGroups),
    [expectedGroups, rangeSelection]
  );

  const selectedRangeRenderNoteIds = useMemo(
    () => selectedRangeGroups.flatMap((group) => group.renderNoteIds),
    [selectedRangeGroups]
  );

  const selectedRangeStartRenderNoteIds = useMemo(
    () => (selectedRangeGroups[0] ? selectedRangeGroups[0].renderNoteIds : []),
    [selectedRangeGroups]
  );

  const selectedRangeEndRenderNoteIds = useMemo(
    () => (selectedRangeGroups.at(-1) ? selectedRangeGroups.at(-1)!.renderNoteIds : []),
    [selectedRangeGroups]
  );

  // Local Practice orchestration
  const localPractice = useLocalPractice({
    artifact,
    mode: practiceMode,
    inputSource,
    scope: selectedRangeScope,
    tempoSelection,
    metronomeEnabled,
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
    if (isRangeSelectionMode) {
      setIsRangeSelectionMode(false);
    } else {
      setIsRangeSelectionMode(true);
      if (rangeSelection.kind === 'FULL_PIECE') {
        setRangeSelection(selectedPracticeRangeSelection());
      }
    }
  };

  const handleRenderNoteClick = useCallback(
    (renderNoteId: string) => {
      if (!isRangeSelectionMode) {
        return;
      }
      const targetGroup = targetForRenderNoteId(expectedGroups, renderNoteId);
      if (!targetGroup) {
        return;
      }
      setRangeSelection((current) =>
        selectPracticeRangeTarget(current, expectedGroups, targetGroup.groupId)
      );
    },
    [expectedGroups, isRangeSelectionMode]
  );

  const handleRestart = async () => {
    setIsCompletionDialogOpen(false);
    await localPractice.restart();
  };

  const handleAdjustSelectedSection = () => {
    setIsCompletionDialogOpen(false);
    void localPractice.finish();
    setIsRangeSelectionMode(true);
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

  const audioWorkletSupported = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const hasAudioContext = typeof (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) !== 'undefined';
    const hasAudioWorklet = typeof AudioWorkletNode !== 'undefined';
    const hasGetUserMedia = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    return hasAudioContext && hasAudioWorklet && hasGetUserMedia;
  }, []);

  const midiSupported = useMemo(() => {
    return typeof navigator !== 'undefined' && typeof (navigator as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function';
  }, []);

  const practiceControls = (
    <PracticeControls
      lifecycle={localPractice.lifecycle}
      isLoading={isLoadingXml}
      isPreparingSession={localPractice.inputState === 'STARTING'}
      canPrepareSession={canPreparePractice}
      audioWorkletSupported={audioWorkletSupported}
      rangeSelectionActive={isRangeSelectionMode}
      canSelectRange={!isActive}
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
            <div className="min-h-0 xl:flex xl:flex-1">
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
                      selectedRangeStartRenderNoteIds={selectedRangeStartRenderNoteIds}
                      selectedRangeEndRenderNoteIds={selectedRangeEndRenderNoteIds}
                      onRenderNoteClick={isRangeSelectionMode ? handleRenderNoteClick : undefined}
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

                  <footer className="absolute bottom-0 left-0 right-0 z-20 flex min-h-20 items-center justify-between border-t border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur sm:px-6">
                    <div className="flex w-full items-center justify-between">
                      {practiceControls}
                    </div>
                  </footer>
                </div>
              </main>

              <div className="hidden xl:block xl:w-80 xl:shrink-0 xl:border-l xl:border-slate-200">
                <PracticeSettingsPanel
                  className="h-full rounded-none border-0 shadow-none"
                  inputState={localPractice.inputState}
                  audioWorkletSupported={audioWorkletSupported}
                  midiSupported={midiSupported}
                  practiceMode={practiceMode}
                  practiceModeLocked={isActive}
                  inputSource={inputSource}
                  microphoneInputLocked={isActive}
                  midiInputLocked={isActive}
                  onPracticeModeChange={setPracticeMode}
                  onInputSourceChange={setInputSource}
                  tempoSelection={tempoSelection}
                  tempoLocked={isActive}
                  scoreTempoSegments={artifact?.scoreTempoSegments}
                  scopeStartBeat={scopeStartBeat}
                  onTempoSelectionChange={setTempoSelection}
                  metronomeEnabled={metronomeEnabled}
                  onMetronomeEnabledChange={handleMetronomeEnabledChange}
                />
              </div>
            </div>
          </div>

          <Sheet open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
            <SheetContent side="right" className="w-full p-0 sm:max-w-md">
              <SheetTitle className="sr-only">{t('settingsTitle')}</SheetTitle>
              <SheetDescription className="sr-only">{t('settingsSubtitle')}</SheetDescription>
              <PracticeSettingsPanel
                className="h-full rounded-none border-0 shadow-none"
                inputState={localPractice.inputState}
                audioWorkletSupported={audioWorkletSupported}
                midiSupported={midiSupported}
                practiceMode={practiceMode}
                practiceModeLocked={isActive}
                inputSource={inputSource}
                microphoneInputLocked={isActive}
                midiInputLocked={isActive}
                onPracticeModeChange={setPracticeMode}
                onInputSourceChange={setInputSource}
                tempoSelection={tempoSelection}
                tempoLocked={isActive}
                scoreTempoSegments={artifact?.scoreTempoSegments}
                scopeStartBeat={scopeStartBeat}
                onTempoSelectionChange={setTempoSelection}
                metronomeEnabled={metronomeEnabled}
                onMetronomeEnabledChange={handleMetronomeEnabledChange}
              />
            </SheetContent>
          </Sheet>

          <PracticeCompletionDialog
            open={isCompletionDialogOpen}
            outcome={completionOutcome}
            sessionMode={practiceMode}
            isLoading={false}
            onOpenChange={setIsCompletionDialogOpen}
            onRestart={handleRestart}
            onAdjustSection={selectedRangeScope ? handleAdjustSelectedSection : undefined}
            onViewSummary={() => {
              setIsCompletionDialogOpen(false);
            }}
          />
        </>
      )}
    </>
  );
}
