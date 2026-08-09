'use client';

import { useTranslations } from 'next-intl';
import { practiceApi } from '@/lib/api';
import {
  useRevisionContent,
  useScoreDetail,
} from '@/hooks/queries/use-score-queries';
import {
  type PracticeAlignmentUpdateMessage,
  type PracticeServerMessage,
} from '@/lib/practice/protocol';
import type { PracticeSessionDetailRead } from '@/generated/practice-api';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { usePracticeAudioStream } from '@/hooks/practice/use-practice-audio-stream';
import { usePracticeRecording } from '@/hooks/practice/use-practice-recording';
import { usePracticeSession } from '@/hooks/practice/use-practice-session';
import { usePracticeSocket } from '@/hooks/practice/use-practice-socket';
import { ClientOnly } from '@/components/client-only';
import { PracticeScoreViewer } from '@/components/practice/practice-score-viewer';
import { PracticeControls } from '@/components/practice/practice-controls';
import { PracticeCompletionDialog } from '@/components/practice/practice-completion-dialog';
import { PracticeSettingsPanel } from '@/components/practice/practice-settings-panel';
import { PracticeSessionStatus } from '@/components/practice/practice-session-status';
import { ResourceLoadError } from '@/components/states';
import { ResourceLoading } from '@/components/loading';
import { ScoreSurface } from '@/components/score/score-surface';
import { WorkspaceAccessDenied } from '@/components/score/workspace-access-denied';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { translateErrorCode, userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';
import { useRouter } from 'next/navigation';
import type {
  PracticeConnectionStatus,
  PracticeStatus,
} from '@/lib/practice/practice-types';

function isReliableAlignmentUpdate(payload: PracticeAlignmentUpdateMessage['payload']) {
  return (
    payload.match_state === 'matched' &&
    payload.audio_active === true &&
    (payload.input_policy_confidence ?? 1) >= 0.55 &&
    (payload.validation_confidence ?? 1) >= 0.55 &&
    payload.visual_confidence >= 0.55
  );
}

export default function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = React.use(params);
  const { id } = resolvedParams;
  const t = useTranslations('practice');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const router = useRouter();
  const { toast } = useToast();

  const [practiceStatus, setPracticeStatus] = useState<PracticeStatus>('idle');
  const [connectionStatus, setConnectionStatus] =
    useState<PracticeConnectionStatus>('disconnected');
  const [isLoading, setIsLoading] = useState(false);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [practiceTime, setPracticeTime] = useState(0);
  const [practiceClockStarted, setPracticeClockStarted] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [alignment, setAlignment] = useState<PracticeAlignmentUpdateMessage['payload'] | null>(null);
  const [isCompletionDialogOpen, setIsCompletionDialogOpen] = useState(false);
  const [completedSessionId, setCompletedSessionId] = useState<string | null>(null);
  const [showNextNoteHint, setShowNextNoteHint] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const displayAlignment = useMemo<PracticeAlignmentUpdateMessage['payload'] | null>(() => {
    if (alignment) {
      return alignment;
    }
    if (!showNextNoteHint) {
      return null;
    }
    if (practiceStatus !== 'arming' && practiceStatus !== 'listening') {
      if (practiceStatus !== 'practicing' && practiceStatus !== 'paused') {
        return null;
      }
    }
    return {
      beat_position: -1,
      confidence: 1,
      alignment_confidence: 1,
      audio_confidence: 1,
      continuity_confidence: 1,
      visual_confidence: 1,
      timestamp_ms: 0,
      score_completed: false,
      audio_active: true,
      input_rms: 0,
      input_peak: 0,
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
    };
  }, [alignment, practiceStatus, showNextNoteHint]);
  const scoreQuery = useScoreDetail(id);
  const scoreCapabilities = scoreQuery.data?.data?.capabilities;
  const canEnterPractice = scoreCapabilities?.can_practice === true;
  const revisionQuery = useRevisionContent(id, scoreQuery.data?.data?.head_revision_id);
  const xmlContent = revisionQuery.data?.data?.content;
  const revisionId = scoreQuery.data?.data?.head_revision_id ?? undefined;
  const isLoadingXml = scoreQuery.isLoading || revisionQuery.isLoading;
  const isResourceLoading =
    scoreQuery.isLoading || (Boolean(scoreQuery.data?.data?.head_revision_id) && revisionQuery.isLoading);
  const loadError = scoreQuery.error ?? revisionQuery.error;
  const resourceMissingAfterLoad = !isResourceLoading && !loadError && (!revisionId || !xmlContent);
  const loadErrorDescription = loadError
    ? userFacingErrorMessage(errors, loadError, common('loadFailedDescription'))
    : resourceMissingAfterLoad
      ? common('loadFailedDescription')
      : null;
  const canPreparePractice = canEnterPractice && Boolean(revisionId && xmlContent) && !isResourceLoading && !loadError;

  const practiceStatusRef = useRef<PracticeStatus>('idle');
  const pausedPracticeStatusRef = useRef<'listening' | 'practicing'>('listening');
  const preconnectStartedRef = useRef(false);
  const preparePracticeSessionRef = useRef<() => Promise<void>>(async () => {});
  const socket = usePracticeSocket({ onMessage: handleSocketMessage, onClose: handleSocketClose });
  const audioStream = usePracticeAudioStream(socket.sendBinary);
  const recording = usePracticeRecording();
  const practiceSession = usePracticeSession({
    scoreId: id,
    revisionId,
  });
  const { audioUrl: audioURL } = recording;
  const hasMicPermission = audioStream.hasMicPermission;
  const audioWorkletSupported = audioStream.isSupported;

  useEffect(() => {
    practiceStatusRef.current = practiceStatus;
  }, [practiceStatus]);

  useEffect(() => {
    if (practiceStatus === 'arming' || practiceStatus === 'practicing') {
      setIsSettingsOpen(false);
    }
  }, [practiceStatus]);

  const updatePracticeStatus = (status: PracticeStatus) => {
    practiceStatusRef.current = status;
    setPracticeStatus(status);
  };

  const preparePracticeSession = useCallback(() => preparePracticeSessionRef.current(), []);

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
      (practiceStatus === 'arming' ||
        practiceStatus === 'listening' ||
        practiceStatus === 'practicing' ||
        practiceStatus === 'paused');

    if (!canHeartbeat) {
      socket.stopHeartbeat();
      return undefined;
    }
    socket.startHeartbeat();
    return socket.stopHeartbeat;
  }, [connectionStatus, practiceStatus, socket]);

  const sendPracticeControl = (type: 'client.pause' | 'client.resume' | 'client.finish') => {
    return socket.sendJson({ type, payload: { t: Date.now() } });
  };

  const sendPracticeInit = (detail: PracticeSessionDetailRead) => {
    if (
      !socket.sendJson({
        type: 'client.init',
        payload: {
          sample_rate: detail.sample_rate,
          channels: detail.channels,
          frame_samples: 640,
        },
      })
    ) {
      throw new Error('Practice websocket is not ready.');
    }
  };

  const finishLocalPractice = (sessionId: string | null = practiceSession.getSessionId()) => {
    audioStream.setStreaming(false);
    setPracticeClockStarted(false);
    recording.stop();
    audioStream.teardown();
    setConnectionStatus('disconnected');
    updatePracticeStatus('finished');
    setCompletedSessionId(sessionId);
    setIsCompletionDialogOpen(true);
  };

  const prepareNextPracticeSession = () => {
    practiceSession.clear();
    preconnectStartedRef.current = false;
    window.setTimeout(() => {
      void preparePracticeSession();
    }, 0);
  };

  function handleSocketMessage(message: PracticeServerMessage) {
    if (message.type === 'session.ready') {
      setConnectionStatus('ready');
      audioStream.setStreaming(true);
      updatePracticeStatus('arming');
      practiceSession.updateState(message.payload.state);
      return;
    }

    if (message.type === 'session.armed') {
      if (practiceStatusRef.current !== 'finished') {
        recording.start();
        setPracticeClockStarted(true);
        updatePracticeStatus('listening');
        if (message.payload.environment_quality === 'noisy') {
          toast({
            title: t('environmentNoisyTitle'),
            description: t('environmentNoisyDesc'),
          });
        } else if (message.payload.environment_quality === 'poor') {
          toast({
            variant: 'destructive',
            title: t('environmentPoorTitle'),
            description: t('environmentPoorDesc'),
          });
        }
      }
      return;
    }

    if (message.type === 'alignment.update') {
      if (!isReliableAlignmentUpdate(message.payload)) {
        return;
      }
      if (
        practiceStatusRef.current === 'arming' ||
        practiceStatusRef.current === 'listening'
      ) {
        updatePracticeStatus('practicing');
      }
      setAlignment(message.payload);
      return;
    }

    if (message.type === 'session.state_changed') {
      if (practiceStatusRef.current === 'finished') {
        return;
      }

      updatePracticeStatus(
        message.payload.state === 'PAUSED'
          ? 'paused'
          : practiceStatusRef.current === 'paused'
            ? pausedPracticeStatusRef.current
            : 'practicing'
      );
      practiceSession.updateState(message.payload.state);
      return;
    }

    if (message.type === 'session.finished') {
      finishLocalPractice(practiceSession.getSessionId());
      practiceSession.updateState(message.payload.state);
      socket.close();
      window.setTimeout(() => {
        prepareNextPracticeSession();
      }, 300);
      return;
    }

    if (message.type === 'session.error') {
      setConnectionStatus('error');
      audioStream.setStreaming(false);
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
      practiceStatusRef.current === 'arming' ||
      practiceStatusRef.current === 'listening' ||
      practiceStatusRef.current === 'practicing' ||
      practiceStatusRef.current === 'paused';
    audioStream.setStreaming(false);
    setConnectionStatus('disconnected');
    if (wasActive && !wasIntentional) {
      updatePracticeStatus('idle');
      toast({
        variant: 'destructive',
        title: t('prepareFailedTitle'),
        description: t('connectionClosedDesc'),
      });
    } else if (!wasIntentional && !wasActive) {
      preconnectStartedRef.current = false;
      window.setTimeout(() => void preparePracticeSession(), 500);
    }
  }

  preparePracticeSessionRef.current = async () => {
    if (preconnectStartedRef.current || !audioWorkletSupported || !canPreparePractice) {
      return;
    }

    preconnectStartedRef.current = true;
    setIsPreparingSession(true);
    setConnectionStatus('connecting');

    try {
      const { wsUrl } = await practiceSession.create();
      await socket.open(wsUrl);
      setConnectionStatus('ready');
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'practice',
        action: 'prepare_session',
        score_id: id,
      });
      preconnectStartedRef.current = false;
      setConnectionStatus('error');
      socket.close();
      toast({
        variant: 'destructive',
        title: t('prepareFailedTitle'),
        description: t('prepareFailedDesc'),
      });
    } finally {
      setIsPreparingSession(false);
    }
  };

  useEffect(() => {
    void preparePracticeSession();
  }, [audioWorkletSupported, canPreparePractice, id, preparePracticeSession]);

  const handleStart = async () => {
    if (!canEnterPractice) {
      return;
    }

    if (!audioWorkletSupported) {
      toast({
        variant: 'destructive',
        title: t('audioWorkletUnsupportedTitle'),
        description: t('audioWorkletUnsupportedDesc'),
      });
      return;
    }

    setIsLoading(true);
    setIsCompletionDialogOpen(false);
    setCompletedSessionId(null);
    recording.reset();
    setAlignment(null);
    setPracticeTime(0);
    setPracticeClockStarted(false);

    try {
      if (!practiceSession.session || !socket.isOpen()) {
        preconnectStartedRef.current = false;
        await preparePracticeSession();
      }

      const detail = practiceSession.getDetail();
      if (!detail || !socket.isOpen()) {
        throw new Error('Practice session is not ready.');
      }

      updatePracticeStatus('arming');
      const stream = await audioStream.setup();
      recording.attach(stream);
      sendPracticeInit(detail);
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'practice',
        action: 'start_session',
        score_id: id,
      });
      const isUnsupportedRealtimeAudio =
        error instanceof Error && error.message === 'practice_realtime_audio_unsupported';
      const isMicrophoneAccessDenied =
        error instanceof DOMException &&
        (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError');
      updatePracticeStatus('idle');
      setPracticeClockStarted(false);
      audioStream.teardown();
      if (isMicrophoneAccessDenied) {
        toast({
          variant: 'destructive',
          title: t('micAccessDeniedTitle'),
          description: t('micAccessDeniedDesc'),
        });
      } else {
        setConnectionStatus('error');
        socket.close();
        toast({
          variant: 'destructive',
          title: isUnsupportedRealtimeAudio
            ? t('audioWorkletUnsupportedTitle')
            : t('prepareFailedTitle'),
          description: isUnsupportedRealtimeAudio
            ? t('audioWorkletUnsupportedDesc')
            : t('prepareFailedDesc'),
        });
      }
    } finally {
      setIsLoading(false);
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
      recording.pause();
      updatePracticeStatus('paused');

      if (!sendPracticeControl('client.pause')) {
        void practiceSession
          .runRestControl('pause', sessionId)
          .catch(() => undefined);
      }
      return;
    }

    if (practiceStatus === 'paused') {
      audioStream.setStreaming(true);
      recording.resume();
      updatePracticeStatus(pausedPracticeStatusRef.current);

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
    finishLocalPractice(currentSessionId);

    if (sendPracticeControl('client.finish')) {
      window.setTimeout(() => {
        socket.close();
        prepareNextPracticeSession();
      }, 300);
      return;
    }

    void practiceSession
      .runRestControl('finish', currentSessionId)
      .catch(() => undefined)
      .finally(() => {
        socket.close();
        prepareNextPracticeSession();
      });
  };

  const handleRestart = () => {
    recording.reset();
    updatePracticeStatus('idle');
    setIsCompletionDialogOpen(false);
    setCompletedSessionId(null);
    setAlignment(null);
    setPracticeTime(0);
    setPracticeClockStarted(false);
  };

  const handleGetAnalysis = async () => {
    const reportSessionId = completedSessionId ?? practiceSession.getSessionId();
    if (!reportSessionId) {
      return;
    }

    setIsLoading(true);
    try {
      const response = await practiceApi.requestPracticeReport(reportSessionId);
      const report = response.data ?? (await practiceApi.getPracticeReport(reportSessionId)).data;
      if (!report?.report_payload) {
        throw new Error('Analysis failed');
      }
      router.push(`/score/${id}/practice/performance?sessionId=${encodeURIComponent(reportSessionId)}`);
    } catch (error) {
      reportUnexpectedClientError(error, {
        area: 'practice',
        action: 'request_report',
        score_id: id,
      });
      toast({
        variant: 'destructive',
        title: t('analysisFailedTitle'),
        description: t('analysisFailedDesc'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const practiceControls = (
    <PracticeControls
      status={practiceStatus}
      connectionStatus={connectionStatus}
      isLoading={isLoading}
      isPreparingSession={isPreparingSession}
      canPrepareSession={canPreparePractice}
      audioWorkletSupported={audioWorkletSupported}
      onStart={() => void handleStart()}
      onPause={handlePause}
      onFinish={handleFinish}
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
      audioWorkletSupported={audioWorkletSupported}
      practiceClockStarted={practiceClockStarted}
      practiceTime={practiceTime}
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
            <div className="relative flex min-h-[38rem] flex-col pb-3 xl:h-full xl:min-h-0 xl:flex-1">
              <ClientOnly>
                <PracticeScoreViewer
                  className="rounded-none border-0 shadow-none xl:min-h-0 xl:flex-1"
                  bottomControls={isMaximized ? practiceControls : null}
                  sessionStatus={practiceSessionStatus}
                  isMaximized={isMaximized}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                  onToggleMaximize={() => setIsMaximized(!isMaximized)}
                  xmlContent={xmlContent || null}
                  isLoadingXml={isLoadingXml}
                  practiceStatus={practiceStatus}
                  alignment={displayAlignment}
                />
              </ClientOnly>
              {!isMaximized ? (
                <div className="relative z-20 mt-3 w-fit max-w-[calc(100%-1.5rem)] self-center rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-lg">
                  {practiceControls}
                </div>
              ) : null}
            </div>
          </main>
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
            showNextNoteHint={showNextNoteHint}
            onShowNextNoteHintChange={setShowNextNoteHint}
          />
        </SheetContent>
      </Sheet>
      </>
      )}
      <PracticeCompletionDialog
        open={isCompletionDialogOpen}
        audioUrl={audioURL}
        isLoading={isLoading}
        canViewPerformance={Boolean(completedSessionId ?? practiceSession.getSessionId())}
        onOpenChange={setIsCompletionDialogOpen}
        onRestart={handleRestart}
        onViewPerformance={() => void handleGetAnalysis()}
      />
    </>
  );
}
