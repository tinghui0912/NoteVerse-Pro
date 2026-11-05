import { resolveVideoExportPlaybackPosition } from './playback-position';
import { renderVideoExportFrameAtTime } from './frame-renderer';
import {
  getVideoExportLayout,
  type VideoExportConfig,
} from './templates';
import {
  findStablePageNumber,
  prefetchEventScoreImage,
  prepareScorePageCache,
  resolveExportPlaybackGeometry,
  type ScorePageCache,
} from './score-model';
import type { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';
import type { VideoExportSession } from './session';

const EXPORT_FPS = 30;

const VIDEO_EXPORT_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export type VideoExportReadiness =
  | { ok: true; mimeType: string }
  | { ok: false; reason: VideoExportBlockReason };

export type VideoExportBlockReason =
  | 'video_not_ready'
  | 'empty_video'
  | 'score_identity_mismatch'
  | 'score_not_ready'
  | 'timebase_unavailable'
  | 'media_recorder_unsupported'
  | 'canvas_capture_unsupported';

type VideoExportProgress = {
  mediaTimeMs: number;
  durationMs: number;
  ratio: number;
};

export type VideoExportResult = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

export type VideoExportOptions = {
  session: VideoExportSession;
  scoreContainer: HTMLElement;
  adapter: PracticeVerovioAdapter;
  scoreEndTick: number; ticksPerQuarter: number;
  signal?: AbortSignal;
  onProgress?: (progress: VideoExportProgress) => void;
  config?: VideoExportConfig;
};

type FrameRenderState = {
  scorePages: ScorePageCache;
  stagingCanvas: HTMLCanvasElement;
  stagingCtx: CanvasRenderingContext2D;
};

export function selectSupportedVideoExportMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  return VIDEO_EXPORT_MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  ) ?? null;
}

export function getVideoExportReadiness({
  session,
  isScoreIdentityConfirmed,
  xmlContent,
  scoreContainer,
}: {
  session: VideoExportSession | null;
  isScoreIdentityConfirmed: boolean;
  xmlContent: string | null;
  scoreContainer: HTMLElement | null;
}): VideoExportReadiness {
  if (!session?.video || session.video.status !== 'READY') {
    return { ok: false, reason: 'video_not_ready' };
  }
  if (session.video.blob.size <= 0) {
    return { ok: false, reason: 'empty_video' };
  }
  if (!isScoreIdentityConfirmed) {
    return { ok: false, reason: 'score_identity_mismatch' };
  }
  if (!xmlContent || !scoreContainer) {
    return { ok: false, reason: 'score_not_ready' };
  }
  if (!session.recordingTimebase?.activeSegments?.length) {
    return { ok: false, reason: 'timebase_unavailable' };
  }
  const mimeType = selectSupportedVideoExportMimeType();
  if (!mimeType) {
    return { ok: false, reason: 'media_recorder_unsupported' };
  }
  if (!canCaptureCanvasStream()) {
    return { ok: false, reason: 'canvas_capture_unsupported' };
  }
  return { ok: true, mimeType };
}

export function composeVideoExportOutputStream(
  canvasStream: MediaStream,
  audioStream: MediaStream
): MediaStream {
  return new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ]);
}

export async function exportVideo({
  session,
  scoreContainer,
  adapter,
  scoreEndTick, ticksPerQuarter,
  signal,
  onProgress,
  config = { orientation: 'landscape', presentation: { kind: 'split' } },
}: VideoExportOptions): Promise<VideoExportResult> {
  const readiness = getVideoExportReadiness({
    session,
    isScoreIdentityConfirmed: true,
    xmlContent: 'ready',
    scoreContainer,
  });
  if (!readiness.ok) {
    throw new Error(`video_export_unavailable:${readiness.reason}`);
  }
  if (session.video.status !== 'READY') {
    throw new Error('video_export_unavailable:video_not_ready');
  }
  const sourceVideo = session.video;
  const layout = getVideoExportLayout(config);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('video_export_unavailable:canvas_context');
  }

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(session.video.blob);
  let audioContext: AudioContext | null = null;
  let canvasStream: MediaStream | null = null;
  let outputStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let frameId: number | null = null;

  try {
    video.src = objectUrl;
    video.preload = 'auto';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    await waitForVideoMetadata(video, signal);
    await waitForVideoFrame(video, signal);
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('video_export_failed:video_decode');
    }

    const scorePages = await prepareScorePageCache(scoreContainer, undefined, {
      visualMode: config.presentation.kind === 'floating' ? 'floating' : 'standard',
    });
    const stagingCanvas = document.createElement('canvas');
    stagingCanvas.width = layout.width;
    stagingCanvas.height = layout.height;
    const stagingCtx = stagingCanvas.getContext('2d');
    if (!stagingCtx) {
      throw new Error('video_export_unavailable:canvas_context');
    }
    const frameState: FrameRenderState = {
      scorePages,
      stagingCanvas,
      stagingCtx,
    };

    await drawExportFrame({
      ctx,
      video,
      session,
      adapter,
      scoreEndTick, ticksPerQuarter,
      frameState,
      config,
    });
    await prefetchUpcomingEventImage({
      mediaTimeMs: Math.max(0, video.currentTime * 1000) + 400,
      video,
      session,
      adapter,
      scoreEndTick, ticksPerQuarter,
      scorePages,
    });

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('video_export_failed:audio_context_unavailable');
    }
    audioContext = new AudioContextCtor();
    const source = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    source.connect(audioDestination);
    if (audioDestination.stream.getAudioTracks().length === 0) {
      throw new Error('video_export_failed:audio_track_missing');
    }

    canvasStream = canvas.captureStream(EXPORT_FPS);
    outputStream = composeVideoExportOutputStream(canvasStream, audioDestination.stream);
    if (outputStream.getAudioTracks().length === 0) {
      throw new Error('video_export_failed:audio_track_missing');
    }

    const chunks: Blob[] = [];
    recorder = new MediaRecorder(outputStream, { mimeType: readiness.mimeType });
    let wasAborted = false;
    let rejectExport: ((reason?: unknown) => void) | null = null;
    const result = new Promise<VideoExportResult>((resolve, reject) => {
      rejectExport = reject;
      recorder!.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder!.onerror = () => reject(new Error('video_export_failed:encoding'));
      recorder!.onstop = () => {
        if (wasAborted || signal?.aborted) {
          reject(new DOMException('Export cancelled', 'AbortError'));
          return;
        }
        const blob = new Blob(chunks, { type: readiness.mimeType });
        if (blob.size <= 0) {
          reject(new Error('video_export_failed:empty_output'));
          return;
        }
        resolve({
          blob,
          mimeType: readiness.mimeType,
          durationMs: Math.max(0, video.currentTime * 1000),
        });
      };
    });

    const stopRecorder = () => {
      wasAborted = Boolean(signal?.aborted);
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    };
    signal?.addEventListener('abort', stopRecorder, { once: true });

    recorder.start(1000);
    await audioContext.resume();
    await video.play();

    const failExport = (error: unknown) => {
      if (signal?.aborted) {
        stopRecorder();
        return;
      }
      rejectExport?.(error);
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    };

    const renderLoop = async () => {
      if (signal?.aborted) {
        stopRecorder();
        return;
      }
      if (video.ended) {
        try {
          await drawExportFrame({
            ctx,
            video,
            session,
            adapter,
            scoreEndTick, ticksPerQuarter,
            frameState,
            config,
          });
        } catch (err) {
          failExport(err);
          return;
        }
        onProgress?.({
          mediaTimeMs: Math.max(0, video.currentTime * 1000),
          durationMs: Math.max(0, video.duration * 1000),
          ratio: 1,
        });
        stopRecorder();
        return;
      }

      try {
        const frameStartedAt = performance.now();
        await drawExportFrame({
          ctx,
          video,
          session,
          adapter,
          scoreEndTick, ticksPerQuarter,
          frameState,
          config,
        });
        const frameWaitMs = performance.now() - frameStartedAt;
        if (frameWaitMs > 250) {
          failExport(new Error('video_export_failed:frame_prepare_timeout'));
          return;
        }
        void prefetchUpcomingEventImage({
          mediaTimeMs: Math.max(0, video.currentTime * 1000) + 400,
          video,
          session,
          adapter,
          scoreEndTick, ticksPerQuarter,
          scorePages: frameState.scorePages,
        }).catch(() => undefined);
      } catch (err) {
        failExport(err);
        return;
      }
      const durationMs = Number.isFinite(video.duration)
        ? Math.max(0, video.duration * 1000)
        : sourceVideo.durationMs;
      const mediaTimeMs = Math.max(0, video.currentTime * 1000);
      onProgress?.({
        mediaTimeMs,
        durationMs,
        ratio: durationMs > 0 ? Math.min(1, mediaTimeMs / durationMs) : 0,
      });
      frameId = window.requestAnimationFrame(() => {
        void renderLoop();
      });
    };

    frameId = window.requestAnimationFrame(() => {
      void renderLoop();
    });

    return await result;
  } finally {
    if (frameId !== null) {
      window.cancelAnimationFrame(frameId);
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
    canvasStream?.getTracks().forEach((track) => track.stop());
    outputStream?.getTracks().forEach((track) => track.stop());
    await audioContext?.close().catch(() => undefined);
  }
}

async function prefetchUpcomingEventImage({
  mediaTimeMs,
  video,
  session,
  adapter,
  scoreEndTick, ticksPerQuarter,
  scorePages,
}: {
  mediaTimeMs: number;
  video: HTMLVideoElement;
  session: VideoExportSession;
  adapter: PracticeVerovioAdapter;
  scoreEndTick: number; ticksPerQuarter: number;
  scorePages: ScorePageCache;
}) {
  const position = resolveVideoExportPlaybackPosition({
    session,
    adapter,
    pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, scorePages),
    mediaTimeMs,
    actualMediaDurationMs: safeDurationMs(video),
    scoreEndTick, ticksPerQuarter,
  });
  if (!position) return;
  const page = scorePages.get(position.pageNumber);
  if (!page) return;
  const playback = resolveExportPlaybackGeometry(page, position.noteIds);
  if (!playback) return;
  await prefetchEventScoreImage(page, position.noteIds, playback.anchorNote.noteId);
}

export async function drawExportFrame({
  ctx,
  video,
  session,
  adapter,
  scoreEndTick, ticksPerQuarter,
  frameState,
  config = { orientation: 'landscape', presentation: { kind: 'split' } },
}: {
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  session: VideoExportSession;
  adapter: PracticeVerovioAdapter;
  scoreEndTick: number; ticksPerQuarter: number;
  frameState: FrameRenderState;
  config?: VideoExportConfig;
}): Promise<void> {
  const layout = getVideoExportLayout(config);

  await renderVideoExportFrameAtTime({
    mediaTimeMs: Math.max(0, video.currentTime * 1000),
    scoreModel: frameState.scorePages,
    playbackTimeline: {
      resolve: (mediaTimeMs) => resolveVideoExportPlaybackPosition({
        session,
        adapter,
        pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, frameState.scorePages),
        mediaTimeMs,
        actualMediaDurationMs:
          session.video.actualMediaDurationMs ?? safeDurationMs(video),
        scoreEndTick, ticksPerQuarter,
      }),
    },
    sourceVideoFrame: video,
    outputCanvas: frameState.stagingCanvas,
    context: frameState.stagingCtx,
    layout,
  });
  ctx.drawImage(frameState.stagingCanvas, 0, 0);
}

function canCaptureCanvasStream(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const canvas = document.createElement('canvas');
  return typeof canvas.captureStream === 'function';
}

function waitForVideoMetadata(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  if (video.readyState >= 1) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('video_export_failed:video_decode'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Export cancelled', 'AbortError'));
    };
    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForVideoFrame(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  if (video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('canplay', onLoaded);
      video.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('video_export_failed:video_decode'));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Export cancelled', 'AbortError'));
    };
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('canplay', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function safeDurationMs(video: HTMLVideoElement): number | null {
  return Number.isFinite(video.duration) && video.duration > 0
    ? video.duration * 1000
    : null;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
