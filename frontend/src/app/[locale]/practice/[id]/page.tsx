'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';
import { Button } from '@/components/ui/button';
import { practiceApi } from '@/lib/api';
import { useXmlContent } from '@/hooks/queries/use-xml-queries';
import {
  type PracticeAlignmentUpdateMessage,
  type PracticeServerMessage,
  type PracticeSessionDetail,
} from '@/types/api';
import { ArrowLeft } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { usePracticeAudioStream } from '@/hooks/practice/use-practice-audio-stream';
import { usePracticeRecording } from '@/hooks/practice/use-practice-recording';
import { usePracticeSession } from '@/hooks/practice/use-practice-session';
import { usePracticeSocket } from '@/hooks/practice/use-practice-socket';
import { ClientOnly } from '@/components/client-only';
import { PracticeScoreViewer } from '@/components/practice/practice-score-viewer';
import { PracticeControls } from '@/components/practice/practice-controls';
import { PracticeStatusPanel } from '@/components/practice/practice-status-panel';
import { PracticeCompletionDialog } from '@/components/practice/practice-completion-dialog';
import { Footer } from '@/components/layout/footer';
import { useRouter, useSearchParams } from 'next/navigation';
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
  const tb = useBackendMessage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const shareToken = searchParams.get('shareToken') || undefined;
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
  const displayAlignment = useMemo<PracticeAlignmentUpdateMessage['payload'] | null>(() => {
    if (alignment) {
      return alignment;
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
  }, [alignment, practiceStatus]);
  const { data: xmlContent, isLoading: isLoadingXml } = useXmlContent(id, 'final', { shareToken });

  const practiceStatusRef = useRef<PracticeStatus>('idle');
  const preconnectStartedRef = useRef(false);
  const preparePracticeSessionRef = useRef<() => Promise<void>>(async () => {});
  const socket = usePracticeSocket({ onMessage: handleSocketMessage, onClose: handleSocketClose });
  const audioStream = usePracticeAudioStream(socket.sendBinary);
  const recording = usePracticeRecording();
  const practiceSession = usePracticeSession({ taskId: id, shareToken });
  const { audioUrl: audioURL } = recording;
  const hasMicPermission = audioStream.hasMicPermission;
  const audioWorkletSupported = audioStream.isSupported;

  useEffect(() => {
    practiceStatusRef.current = practiceStatus;
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
      (practiceStatus === 'arming' ||
        practiceStatus === 'listening' ||
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

  const sendPracticeInit = (detail: PracticeSessionDetail) => {
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
        updatePracticeStatus('listening');
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

      updatePracticeStatus(message.payload.state === 'PAUSED' ? 'paused' : 'practicing');
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
        title: t('analysisFailedTitle'),
        description: tb(message.payload.code) || message.payload.message,
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
        title: t('analysisFailedTitle'),
        description: 'Practice realtime connection was closed. Please start again.',
      });
    } else if (!wasIntentional && !wasActive) {
      preconnectStartedRef.current = false;
      window.setTimeout(() => void preparePracticeSession(), 500);
    }
  }

  preparePracticeSessionRef.current = async () => {
    if (preconnectStartedRef.current || !audioWorkletSupported) {
      return;
    }

    preconnectStartedRef.current = true;
    setIsPreparingSession(true);
    setConnectionStatus('connecting');

    try {
      const { wsUrl } = await practiceSession.create();
      await socket.open(wsUrl);
      setConnectionStatus('ready');
    } catch {
      console.warn('Practice session preparation failed.');
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
  }, [audioWorkletSupported, id, preparePracticeSession, shareToken]);

  const handleStart = async () => {
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
      setPracticeClockStarted(true);
      recording.start();
    } catch (error) {
      console.error('Failed to start practice session:', error);
      const isUnsupportedAudioWorklet =
        error instanceof Error && error.message.includes('AudioWorklet is not supported');
      updatePracticeStatus('idle');
      setPracticeClockStarted(false);
      setConnectionStatus('error');
      audioStream.teardown();
      socket.close();
      toast({
        variant: 'destructive',
        title: isUnsupportedAudioWorklet
          ? t('audioWorkletUnsupportedTitle')
          : t('analysisFailedTitle'),
        description: isUnsupportedAudioWorklet
          ? t('audioWorkletUnsupportedDesc')
          : t('analysisFailedDesc'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = () => {
    const sessionId = practiceSession.getSessionId();
    if (!sessionId) {
      return;
    }

    if (practiceStatus === 'practicing') {
      audioStream.setStreaming(false);
      recording.pause();
      updatePracticeStatus('paused');

      if (!sendPracticeControl('client.pause')) {
        void practiceSession
          .runRestControl('pause', sessionId)
          .catch((error) => {
            console.error('Failed to pause practice session:', error);
          });
      }
      return;
    }

    if (practiceStatus === 'paused') {
      audioStream.setStreaming(true);
      recording.resume();
      updatePracticeStatus('practicing');

      if (!sendPracticeControl('client.resume')) {
        void practiceSession
          .runRestControl('resume', sessionId)
          .catch((error) => {
            console.error('Failed to resume practice session:', error);
          });
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
      .catch((error) => {
        console.error('Failed to finish practice session:', error);
      })
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
    setConnectionStatus('disconnected');
    setAlignment(null);
    setPracticeTime(0);
    setPracticeClockStarted(false);
    practiceSession.clear();
    preconnectStartedRef.current = false;
    audioStream.teardown();
    socket.close();
    window.setTimeout(() => {
      void preparePracticeSession();
    }, 0);
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
        throw new Error(response.message || 'Analysis failed');
      }
      router.push(`/practice/${id}/performance?sessionId=${encodeURIComponent(reportSessionId)}`);
    } catch (error) {
      console.error('Failed to get practice analysis:', error);
      toast({
        variant: 'destructive',
        title: t('analysisFailedTitle'),
        description: t('analysisFailedDesc'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4">
          <div className="w-full flex items-center">
            <div className="w-12 shrink-0">
              <Button
                variant="ghost"
                onClick={() => router.back()}
                className="text-white hover:bg-white/10 hover:text-white h-12 w-12 rounded-full [&_svg]:size-6"
              >
                <ArrowLeft />
              </Button>
            </div>
            <div className="flex-1 text-center">
              <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('mode')}</h1>
              <p className="text-lg text-gray-300">{t('subtitle')}</p>
            </div>
            <div className="w-12 shrink-0" />
          </div>
        </div>
      </div>

      <main className="grow">
        <div className="max-w-4xl mx-auto px-4 py-16">
          <div className="flex flex-col gap-4">
            <div className="w-full space-y-6">
              <PracticeStatusPanel
                status={practiceStatus}
                hasMicPermission={hasMicPermission}
                audioWorkletSupported={audioWorkletSupported}
              />

              <div className="relative">
                <ClientOnly>
                  <PracticeScoreViewer
                    isMaximized={isMaximized}
                    onToggleMaximize={() => setIsMaximized(!isMaximized)}
                    xmlContent={xmlContent || null}
                    isLoadingXml={isLoadingXml}
                    toolbar={
                      <PracticeControls
                        status={practiceStatus}
                        connectionStatus={connectionStatus}
                        isLoading={isLoading}
                        isPreparingSession={isPreparingSession}
                        audioWorkletSupported={audioWorkletSupported}
                        practiceClockStarted={practiceClockStarted}
                        practiceTime={practiceTime}
                        onStart={() => void handleStart()}
                        onPause={handlePause}
                        onFinish={handleFinish}
                      />
                    }
                    practiceStatus={practiceStatus}
                    alignment={displayAlignment}
                  />
                </ClientOnly>
              </div>
            </div>
          </div>
        </div>
      </main>
      <PracticeCompletionDialog
        open={isCompletionDialogOpen}
        audioUrl={audioURL}
        isLoading={isLoading}
        canViewPerformance={Boolean(completedSessionId ?? practiceSession.getSessionId())}
        onOpenChange={setIsCompletionDialogOpen}
        onRestart={handleRestart}
        onViewPerformance={() => void handleGetAnalysis()}
      />
      <Footer />
    </div>
  );
}
