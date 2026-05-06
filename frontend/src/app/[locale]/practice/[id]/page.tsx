'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { practiceApi, xmlApi } from '@/lib/api';
import {
  type PracticeAlignmentUpdateMessage,
  type PracticeReportPayload,
  type PracticeServerMessage,
  type PracticeSessionDetail,
} from '@/types/api';
import { getToken } from '@/lib/api-client';
import {
  Mic,
  Pause,
  Play,
  Square,
  Repeat,
  Lightbulb,
  LoaderCircle,
  Target,
  FileText,
  ArrowLeft,
  Activity,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ClientOnly } from '@/components/client-only';
import { PracticeScoreViewer } from '@/components/practice/practice-score-viewer';
import { Footer } from '@/components/layout/footer';
import { useRouter, useSearchParams } from 'next/navigation';

const PCM_SAMPLE_RATE = 16000;
const PCM_CHANNELS = 1;
const PCM_FRAME_FORMAT = 'pcm_s16le';

type PracticeStatus = 'idle' | 'connecting' | 'practicing' | 'paused' | 'finished';
type ConnectionStatus = 'disconnected' | 'connecting' | 'ready' | 'error';

const ReportCard = ({
  icon,
  title,
  content,
}: {
  icon: React.ElementType;
  title: string;
  content: string;
}) => {
  const Icon = icon;
  return (
    <Card className="bg-white shadow-lg rounded-2xl">
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <Icon className="h-6 w-6 text-primary" />
        <CardTitle className="text-lg font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground whitespace-pre-line">{content}</p>
      </CardContent>
    </Card>
  );
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function buildPracticeWebSocketUrl(path: string, token: string) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
  const url = new URL(window.location.href);
  const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const normalizedBase = apiBaseUrl.startsWith('http')
    ? apiBaseUrl
    : `${url.origin}${apiBaseUrl.startsWith('/') ? apiBaseUrl : `/${apiBaseUrl}`}`;
  const wsBase = normalizedBase.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  const socketUrl = new URL(path, `${wsBase.endsWith('/') ? wsBase : `${wsBase}/`}`);
  socketUrl.protocol = wsProtocol;
  socketUrl.searchParams.set('token', token);
  return socketUrl.toString();
}

function convertFloat32ToPcm16(samples: Float32Array) {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

function downsampleTo16k(input: Float32Array, inputSampleRate: number) {
  if (inputSampleRate === PCM_SAMPLE_RATE) {
    return input;
  }

  const ratio = inputSampleRate / PCM_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = Math.min(input.length - 1, Math.round(index * ratio));
    output[index] = input[sourceIndex] ?? 0;
  }

  return output;
}

function normalizeWorkletSamples(data: unknown): Float32Array | null {
  if (data instanceof Float32Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Float32Array(data);
  }

  if (ArrayBuffer.isView(data) && data.buffer instanceof ArrayBuffer) {
    return new Float32Array(data.buffer.slice(0));
  }

  if (Array.isArray(data)) {
    return new Float32Array(data);
  }

  return null;
}

function isAudioWorkletSupported() {
  if (typeof window === 'undefined') {
    return true;
  }

  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextConstructor) {
    return false;
  }

  return 'AudioWorkletNode' in window;
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
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [analysisReport, setAnalysisReport] = useState<PracticeReportPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [practiceTime, setPracticeTime] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);
  const [audioWorkletSupported, setAudioWorkletSupported] = useState(true);
  const [audioURL, setAudioURL] = useState<string | null>(null);
  const [session, setSession] = useState<PracticeSessionDetail | null>(null);
  const [alignment, setAlignment] = useState<PracticeAlignmentUpdateMessage['payload'] | null>(null);
  const [xmlContent, setXmlContent] = useState<string | null>(null);
  const [isLoadingXml, setIsLoadingXml] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isStreamingAudioRef = useRef(false);
  const practiceStatusRef = useRef<PracticeStatus>('idle');
  const isIntentionalSocketCloseRef = useRef(false);
  const pointerHandledControlRef = useRef<string | null>(null);

  useEffect(() => {
    practiceStatusRef.current = practiceStatus;
  }, [practiceStatus]);

  const updatePracticeStatus = (status: PracticeStatus) => {
    practiceStatusRef.current = status;
    setPracticeStatus(status);
  };

  const runPointerControl = (
    event: React.PointerEvent<HTMLButtonElement>,
    control: string,
    action: () => void
  ) => {
    event.preventDefault();
    pointerHandledControlRef.current = control;
    action();
  };

  const runClickControl = (control: string, action: () => void) => {
    if (pointerHandledControlRef.current === control) {
      pointerHandledControlRef.current = null;
      return;
    }

    action();
  };

  useEffect(() => {
    setAudioWorkletSupported(isAudioWorkletSupported());
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (practiceStatus === 'practicing') {
      timer = setInterval(() => {
        setPracticeTime((prevTime) => prevTime + 1);
      }, 1000);
    }
    return () => {
      if (timer) {
        clearInterval(timer);
      }
    };
  }, [practiceStatus]);

  useEffect(() => {
    let cancelled = false;

    const loadPracticeXml = async () => {
      try {
        setIsLoadingXml(true);
        const content = await xmlApi.loadXml(id, 'final', shareToken);
        if (!cancelled) {
          setXmlContent(content || null);
        }
      } catch (error) {
        console.error('Failed to load practice XML:', error);
        if (!cancelled) {
          setXmlContent(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoadingXml(false);
        }
      }
    };

    void loadPracticeXml();

    return () => {
      cancelled = true;
    };
  }, [id, shareToken]);

  useEffect(() => {
    return () => {
      teardownAudioPipeline();
      closeSocket();
    };
  }, []);

  useEffect(() => {
    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    const socket = websocketRef.current;
    const canHeartbeat =
      socket &&
      socket.readyState === WebSocket.OPEN &&
      (practiceStatus === 'practicing' || practiceStatus === 'paused');

    if (!canHeartbeat) {
      return;
    }

    heartbeatIntervalRef.current = window.setInterval(() => {
      const activeSocket = websocketRef.current;
      if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      activeSocket.send(
        JSON.stringify({
          type: 'client.heartbeat',
          payload: { t: Date.now() },
        })
      );
    }, 5000);

    return () => {
      if (heartbeatIntervalRef.current !== null) {
        window.clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [practiceStatus, connectionStatus]);

  const closeSocket = () => {
    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    const socket = websocketRef.current;
    websocketRef.current = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      isIntentionalSocketCloseRef.current = true;
      socket.close();
    }
  };

  const teardownAudioPipeline = () => {
    isStreamingAudioRef.current = false;
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    muteGainRef.current?.disconnect();
    muteGainRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const sendPcmFrame = (samples: Float32Array, inputSampleRate: number) => {
    if (!isStreamingAudioRef.current) {
      return;
    }

    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const pcmSamples = downsampleTo16k(samples, inputSampleRate);
    socket.send(convertFloat32ToPcm16(pcmSamples));
  };

  const syncSessionState = (detail: PracticeSessionDetail) => {
    setSession(detail);
    sessionIdRef.current = detail.session_id;
  };

  const sendPracticeControl = (type: 'client.pause' | 'client.resume' | 'client.finish') => {
    const socket = websocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(
      JSON.stringify({
        type,
        payload: { t: Date.now() },
      })
    );
    return true;
  };

  const finishLocalPractice = () => {
    isStreamingAudioRef.current = false;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    teardownAudioPipeline();
    setConnectionStatus('disconnected');
    updatePracticeStatus('finished');
  };

  const setupAudioPipeline = async () => {
    if (!isAudioWorkletSupported()) {
      setAudioWorkletSupported(false);
      throw new Error('AudioWorklet is not supported in this browser.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    setHasMicPermission(true);

    if (typeof MediaRecorder !== 'undefined') {
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const nextAudioUrl = URL.createObjectURL(audioBlob);
        setAudioURL((currentUrl) => {
          if (currentUrl) {
            URL.revokeObjectURL(currentUrl);
          }
          return nextAudioUrl;
        });
        audioChunksRef.current = [];
      };
    }

    const AudioContextConstructor = window.AudioContext || (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error('AudioContext is not supported in this browser.');
    }

    const audioContext = new AudioContextConstructor();
    audioContextRef.current = audioContext;
    await audioContext.resume();
    const sourceNode = audioContext.createMediaStreamSource(stream);
    sourceNodeRef.current = sourceNode;
    const muteGain = audioContext.createGain();
    muteGain.gain.value = 0;
    muteGainRef.current = muteGain;
    await audioContext.audioWorklet.addModule('/audio-worklets/practice-pcm-processor.js');
    const workletNode = new AudioWorkletNode(audioContext, 'practice-pcm-processor');
    workletNode.port.onmessage = (event: MessageEvent<unknown>) => {
      const samples = normalizeWorkletSamples(event.data);
      if (!samples || samples.length === 0) {
        return;
      }
      sendPcmFrame(samples, audioContext.sampleRate);
    };
    workletNodeRef.current = workletNode;

    sourceNode.connect(workletNode);
    workletNode.connect(muteGain);
    muteGain.connect(audioContext.destination);
  };

  const handleSocketMessage = (message: PracticeServerMessage) => {
    if (message.type === 'session.ready') {
      setConnectionStatus('ready');
      isStreamingAudioRef.current = true;
      updatePracticeStatus('practicing');
      setSession((current) =>
        current ? { ...current, state: message.payload.state } : current
      );
      return;
    }

    if (message.type === 'alignment.update') {
      setAlignment(message.payload);
      return;
    }

    if (message.type === 'session.state_changed') {
      if (practiceStatusRef.current === 'finished') {
        return;
      }

      updatePracticeStatus(message.payload.state === 'PAUSED' ? 'paused' : 'practicing');
      setSession((current) =>
        current ? { ...current, state: message.payload.state } : current
      );
      return;
    }

    if (message.type === 'session.finished') {
      finishLocalPractice();
      setSession((current) =>
        current ? { ...current, state: message.payload.state } : current
      );
      closeSocket();
      return;
    }

    if (message.type === 'session.warning') {
      toast({
        title: t('analysisFailedTitle'),
        description: tb(message.payload.code) || message.payload.message,
      });
      return;
    }

    if (message.type === 'session.error') {
      setConnectionStatus('error');
      isStreamingAudioRef.current = false;
      toast({
        variant: 'destructive',
        title: t('analysisFailedTitle'),
        description: tb(message.payload.code) || message.payload.message,
      });
    }
  };

  const openPracticeSocket = async (detail: PracticeSessionDetail, wsPath: string) => {
    const token = getToken();
    if (!token) {
      throw new Error('Missing access token.');
    }

    const wsUrl = buildPracticeWebSocketUrl(wsPath, token);
    const socket = new WebSocket(wsUrl);
    websocketRef.current = socket;
    isIntentionalSocketCloseRef.current = false;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as PracticeServerMessage;
      handleSocketMessage(message);
    };

    socket.onclose = () => {
      const wasIntentional = isIntentionalSocketCloseRef.current;
      isIntentionalSocketCloseRef.current = false;
      const wasActive =
        practiceStatusRef.current === 'connecting' ||
        practiceStatusRef.current === 'practicing' ||
        practiceStatusRef.current === 'paused';
      websocketRef.current = null;
      isStreamingAudioRef.current = false;
      setConnectionStatus('disconnected');
      if (wasActive && !wasIntentional) {
        updatePracticeStatus('idle');
        toast({
          variant: 'destructive',
          title: t('analysisFailedTitle'),
          description: 'Practice realtime connection was closed. Please start again.',
        });
      }
    };

    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('Practice websocket connection failed.'));
    });

    socket.send(
      JSON.stringify({
        type: 'client.init',
        payload: {
          sample_rate: detail.sample_rate,
          channels: detail.channels,
          frame_samples: 640,
        },
      })
    );
  };

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
    setAnalysisReport(null);
    setAlignment(null);
    setPracticeTime(0);

    try {
      setConnectionStatus('connecting');
      updatePracticeStatus('connecting');

      const createResponse = await practiceApi.createPracticeSession({
        task_id: id,
        source: 'final',
        share_token: shareToken,
        sample_rate: PCM_SAMPLE_RATE,
        channels: PCM_CHANNELS,
        frame_format: PCM_FRAME_FORMAT,
      });

      if (!createResponse.data?.session_id || !createResponse.data.ws_url) {
        throw new Error(createResponse.message || 'Practice session creation failed.');
      }

      const detailResponse = await practiceApi.getPracticeSession(createResponse.data.session_id);
      if (!detailResponse.data) {
        throw new Error(detailResponse.message || 'Practice session details are unavailable.');
      }

      syncSessionState(detailResponse.data);
      await setupAudioPipeline();
      await openPracticeSocket(detailResponse.data, createResponse.data.ws_url);

      if (mediaRecorderRef.current?.state === 'inactive') {
        audioChunksRef.current = [];
        mediaRecorderRef.current.start();
      }
    } catch (error) {
      console.error('Failed to start practice session:', error);
      const isUnsupportedAudioWorklet =
        error instanceof Error && error.message.includes('AudioWorklet is not supported');
      updatePracticeStatus('idle');
      setConnectionStatus('error');
      teardownAudioPipeline();
      closeSocket();
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
    if (!sessionIdRef.current) {
      return;
    }

    if (practiceStatus === 'practicing') {
      isStreamingAudioRef.current = false;
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.pause();
      }
      updatePracticeStatus('paused');

      if (!sendPracticeControl('client.pause')) {
        void practiceApi
          .pausePracticeSession(sessionIdRef.current)
          .then((response) => {
            if (response.data) {
              syncSessionState(response.data);
            }
          })
          .catch((error) => {
            console.error('Failed to pause practice session:', error);
          });
      }
      return;
    }

    if (practiceStatus === 'paused') {
      isStreamingAudioRef.current = true;
      if (mediaRecorderRef.current?.state === 'paused') {
        mediaRecorderRef.current.resume();
      }
      updatePracticeStatus('practicing');

      if (!sendPracticeControl('client.resume')) {
        void practiceApi
          .resumePracticeSession(sessionIdRef.current)
          .then((response) => {
            if (response.data) {
              syncSessionState(response.data);
            }
          })
          .catch((error) => {
            console.error('Failed to resume practice session:', error);
          });
      }
    }
  };

  const handleFinish = () => {
    if (!sessionIdRef.current) {
      return;
    }

    const currentSessionId = sessionIdRef.current;
    finishLocalPractice();

    if (sendPracticeControl('client.finish')) {
      window.setTimeout(closeSocket, 300);
      return;
    }

    void practiceApi
      .finishPracticeSession(currentSessionId)
      .then((response) => {
        if (response.data) {
          syncSessionState(response.data);
        }
      })
      .catch((error) => {
        console.error('Failed to finish practice session:', error);
      });
  };

  const handleRestart = () => {
    setAudioURL((currentUrl) => {
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
      return null;
    });
    updatePracticeStatus('idle');
    setConnectionStatus('disconnected');
    setAnalysisReport(null);
    setAlignment(null);
    setPracticeTime(0);
    setSession(null);
    sessionIdRef.current = null;
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    teardownAudioPipeline();
    closeSocket();
  };

  const handleGetAnalysis = async () => {
    if (!sessionIdRef.current) {
      return;
    }

    setIsLoading(true);
    setAnalysisReport(null);
    try {
      const response = await practiceApi.requestPracticeReport(sessionIdRef.current);
      const report = response.data ?? (await practiceApi.getPracticeReport(sessionIdRef.current)).data;
      if (!report?.report_payload) {
        throw new Error(response.message || 'Analysis failed');
      }
      setAnalysisReport(report.report_payload);
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

  const PracticeToolbar = () => {
    if (practiceStatus === 'idle') {
      return (
        <div className="flex items-center justify-center gap-3">
          <Button
            type="button"
            onClick={handleStart}
            size="lg"
            disabled={isLoading || !audioWorkletSupported}
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold group"
          >
            {isLoading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Mic className="mr-2 h-4 w-4" />}
            {t('start')}
          </Button>
        </div>
      );
    }
    if (practiceStatus === 'connecting') {
      return (
        <Button disabled size="lg" className="bg-orange-500 text-white font-semibold">
          <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          {t('start')}
        </Button>
      );
    }
    if (practiceStatus === 'practicing' || practiceStatus === 'paused') {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex items-center gap-2 rounded-full bg-destructive/90 px-3 py-2 text-sm font-medium text-destructive-foreground">
            <Mic className={cn('h-4 w-4', practiceStatus === 'practicing' && 'animate-pulse')} />
            <span>{formatTime(practiceTime)}</span>
          </div>
          <Button
            type="button"
            onPointerDown={(event) => {
              runPointerControl(event, 'pause', handlePause);
            }}
            onClick={() => runClickControl('pause', handlePause)}
            variant="outline"
            className="bg-white"
          >
            {practiceStatus === 'paused' ? (
              <Play className="mr-2 h-4 w-4" />
            ) : (
              <Pause className="mr-2 h-4 w-4" />
            )}
            {t(practiceStatus === 'paused' ? 'resume' : 'pause')}
          </Button>
          <Button
            type="button"
            onPointerDown={(event) => {
              runPointerControl(event, 'finish', handleFinish);
            }}
            onClick={() => runClickControl('finish', handleFinish)}
            variant="destructive"
          >
            <Square className="mr-2 h-4 w-4" /> {t('finish')}
          </Button>
        </div>
      );
    }
    return null;
  };

  const recommendations = analysisReport?.recommendations.join('\n') || '';
  const metricsContent = analysisReport
    ? Object.entries(analysisReport.metrics)
        .map(([key, value]) => `${key}: ${value ?? 'n/a'}`)
        .join('\n')
    : '';

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

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-16">
          <div className="flex flex-col gap-4">
            <div className="w-full space-y-6">
              {hasMicPermission === false && practiceStatus === 'idle' && (
                <div className="mb-4">
                  <Alert variant="destructive">
                    <Mic className="h-4 w-4" />
                    <AlertTitle>{t('micAccessDeniedAlertTitle')}</AlertTitle>
                    <AlertDescription>{t('micAccessDeniedAlertDesc')}</AlertDescription>
                  </Alert>
                </div>
              )}

              {!audioWorkletSupported && practiceStatus === 'idle' && (
                <div className="mb-4">
                  <Alert variant="destructive">
                    <Mic className="h-4 w-4" />
                    <AlertTitle>{t('audioWorkletUnsupportedAlertTitle')}</AlertTitle>
                    <AlertDescription>{t('audioWorkletUnsupportedAlertDesc')}</AlertDescription>
                  </Alert>
                </div>
              )}

              <div className="relative">
                <ClientOnly>
                  <PracticeScoreViewer
                    isMaximized={isMaximized}
                    onToggleMaximize={() => setIsMaximized(!isMaximized)}
                    xmlContent={xmlContent}
                    isLoadingXml={isLoadingXml}
                    toolbar={<PracticeToolbar />}
                    practiceStatus={practiceStatus}
                    alignment={alignment}
                  />
                </ClientOnly>
              </div>

              {practiceStatus === 'finished' && (
                <div className="mt-8 space-y-6 pb-16">
                  <Card className="bg-white rounded-2xl shadow-lg">
                    <CardHeader>
                      <CardTitle>{t('finished')}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {audioURL && (
                        <div className="flex flex-col gap-2">
                          <p className="text-sm font-medium text-muted-foreground">{t('playback')}</p>
                          <audio src={audioURL} controls className="w-full" />
                        </div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Button
                          onClick={handleGetAnalysis}
                          disabled={isLoading || !sessionIdRef.current}
                          size="lg"
                          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                        >
                          {isLoading ? (
                            <LoaderCircle className="mr-2 h-5 w-5 animate-spin" />
                          ) : (
                            <FileText className="mr-2 h-5 w-5" />
                          )}
                          {t('aiCritique')}
                        </Button>
                        <Button onClick={handleRestart} variant="outline" size="lg" className="bg-white">
                          <Repeat className="mr-2 h-5 w-5" /> {t('restart')}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>

                  {isLoading && (
                    <div className="text-center py-12">
                      <LoaderCircle className="mx-auto h-12 w-12 animate-spin text-primary" />
                      <p className="mt-4 text-lg text-muted-foreground">{t('generatingReport')}</p>
                    </div>
                  )}

                  {analysisReport && (
                    <div className="space-y-6">
                      <div className="text-center">
                        <h2 className="font-headline text-2xl font-bold tracking-tight text-foreground">
                          {t('report')}
                        </h2>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <ReportCard icon={Target} title="Summary" content={analysisReport.summary} />
                        <ReportCard icon={Activity} title="Metrics" content={metricsContent} />
                      </div>
                      <ReportCard icon={Lightbulb} title="Recommendations" content={recommendations} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
