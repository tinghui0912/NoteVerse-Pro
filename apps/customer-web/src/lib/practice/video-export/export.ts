import { openVideoExportOutputMedia } from './output-media';
import {
  releaseOwnedMedia,
  type OwnedMediaHandle,
} from '@/lib/practice/recording/owned-media';
import { resolveVideoExportPlaybackPosition } from './playback-position';
import { renderVideoExportFrameAtTime } from './frame-renderer';
import { getVideoExportLayout, type VideoExportConfig } from './templates';
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
const VIDEO_EXPORT_CHUNK_TIMESLICE_MS = 1000;

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

export type VideoExportResult = Readonly<{
  media: OwnedMediaHandle;
  mimeType: string;
  durationMs: number;
}>;

export type VideoExportOptions = {
  session: VideoExportSession;
  scoreContainer: HTMLElement;
  adapter: PracticeVerovioAdapter;
  scoreEndTick: number;
  ticksPerQuarter: number;
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
  return (
    VIDEO_EXPORT_MIME_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    ) ?? null
  );
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
  if (session.video.media.blob.size <= 0) {
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
  audioStream: MediaStream,
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
  scoreEndTick,
  ticksPerQuarter,
  signal,
  onProgress,
  config = { orientation: 'landscape', presentation: { kind: 'split' } },
}: VideoExportOptions): Promise<VideoExportResult> {
  const checkCancellation = () => {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  };
  checkCancellation();
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
  const objectUrl = URL.createObjectURL(session.video.media.blob);
  let audioContext: AudioContext | null = null;
  let canvasStream: MediaStream | null = null;
  let outputStream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let frameId: number | null = null;
  let outputFile: Awaited<
    ReturnType<typeof openVideoExportOutputMedia>
  > | null = null;
  let outputMedia: OwnedMediaHandle | null = null;
  let abortingOutput: Promise<void> | null = null;
  let detachAbort: (() => void) | null = null;
  let completedResult: VideoExportResult | null = null;
  let outputFailure: unknown;
  const abortOutput = () =>
    (abortingOutput ??= outputFile?.abort() ?? Promise.resolve());
  const stopOutput = () => {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } finally {
      canvasStream?.getTracks().forEach((track) => track.stop());
      outputStream?.getTracks().forEach((track) => track.stop());
    }
  };

  try {
    try {
      video.src = objectUrl;
      video.preload = 'auto';
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      await waitForVideoMetadata(video, signal);
      await waitForVideoFrame(video, signal);
      checkCancellation();
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('video_export_failed:video_decode');
      }

      const scorePages = await prepareScorePageCache(
        scoreContainer,
        undefined,
        {
          visualMode:
            config.presentation.kind === 'floating' ? 'floating' : 'standard',
        },
      );
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
        scoreEndTick,
        ticksPerQuarter,
        frameState,
        config,
      });
      await prefetchUpcomingEventImage({
        mediaTimeMs: Math.max(0, video.currentTime * 1000) + 400,
        video,
        session,
        adapter,
        scoreEndTick,
        ticksPerQuarter,
        scorePages,
      });

      checkCancellation();
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
      outputStream = composeVideoExportOutputStream(
        canvasStream,
        audioDestination.stream,
      );
      if (outputStream.getAudioTracks().length === 0) {
        throw new Error('video_export_failed:audio_track_missing');
      }

      outputFile = await openVideoExportOutputMedia(signal);
      checkCancellation();
      recorder = new MediaRecorder(outputStream, {
        mimeType: readiness.mimeType,
      });
      let phase: 'ENCODING' | 'DRAINING' | 'SEALED' | 'FAILED' = 'ENCODING';
      const acceptingFrames = () => phase === 'ENCODING' && !signal?.aborted;
      let writes: Promise<void> = Promise.resolve();
      let sealing: Promise<void> | null = null;
      let failExport!: (error: unknown) => void;
      const result = new Promise<VideoExportResult>((resolve, reject) => {
        failExport = (error) => {
          if (phase === 'FAILED') return;
          phase = 'FAILED';
          outputFailure = error;
          // Fence callbacks before stop(), which can synchronously publish final events.
          try {
            stopOutput();
          } catch {
            /* Storage retirement still runs if encoder stop fails. */
          }
          const retirement = abortOutput();
          void Promise.allSettled([retirement, writes, sealing]).then(
            (outcomes) => {
              const cleanup = outcomes[0];
              reject(
                cleanup.status === 'rejected'
                  ? new Error('video_export_failed:output_cleanup', {
                      cause: cleanup.reason,
                    })
                  : error,
              );
            },
          );
        };
        recorder!.ondataavailable = (event) => {
          if (phase !== 'ENCODING' || !event.data?.size) return;
          // The OPFS primitive serializes accepted appends in event order and releases
          // each chunk after its write. No complete-output chunk collection exists.
          writes = outputFile!.append(event.data).catch((cause) => {
            failExport(
              new Error('video_export_failed:output_write', { cause }),
            );
          });
        };
        recorder!.onerror = () =>
          failExport(new Error('video_export_failed:encoding'));
        recorder!.onstop = () => {
          if (phase !== 'ENCODING') return;
          phase = 'DRAINING';
          const durationMs = Math.max(0, video.currentTime * 1000);
          sealing = (async () => {
            await writes;
            if (phase !== 'DRAINING') return;
            const media = await outputFile!.seal(readiness.mimeType);
            outputMedia = media;
            if (phase !== 'DRAINING' || signal?.aborted) return;
            if (media.byteSize <= 0) {
              failExport(new Error('video_export_failed:empty_output'));
              return;
            }
            phase = 'SEALED';
            resolve(
              Object.freeze({
                media,
                mimeType: readiness.mimeType,
                durationMs,
              }),
            );
          })().catch(failExport);
        };
      });
      const onAbort = () =>
        failExport(new DOMException('Export cancelled', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      detachAbort = () => signal?.removeEventListener('abort', onAbort);
      const stopRecorder = () => {
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      };

      const renderLoop = async () => {
        if (!acceptingFrames()) return;
        if (video.ended) {
          try {
            await drawExportFrame({
              ctx,
              video,
              session,
              adapter,
              scoreEndTick,
              ticksPerQuarter,
              frameState,
              config,
            });
          } catch (err) {
            failExport(err);
            return;
          }
          if (!acceptingFrames()) return;
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
            scoreEndTick,
            ticksPerQuarter,
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
            scoreEndTick,
            ticksPerQuarter,
            scorePages: frameState.scorePages,
          }).catch(() => undefined);
        } catch (err) {
          failExport(err);
          return;
        }
        if (!acceptingFrames()) return;
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
          void renderLoop().catch(failExport);
        });
      };

      // Observe encoder/output outcomes immediately, including while playback startup
      // is asynchronous. Startup failures enter the same single retirement path.
      void (async () => {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        recorder!.start(VIDEO_EXPORT_CHUNK_TIMESLICE_MS);
        await audioContext!.resume();
        if (!acceptingFrames()) return;
        await video.play();
        if (!acceptingFrames()) return;
        frameId = window.requestAnimationFrame(() => {
          void renderLoop().catch(failExport);
        });
      })().catch(failExport);
      completedResult = await result;
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
    // Publication is after asynchronous browser teardown. Cancellation during seal
    // or teardown still belongs to this operation, never to a caller.
    checkCancellation();
    if (outputFailure) throw outputFailure;
    if (!outputMedia) throw new Error('video_export_failed:empty_output');
    if (!completedResult) throw new Error('video_export_failed:empty_output');
    const exported = completedResult;
    outputMedia = null;
    outputFile = null;
    return exported;
  } finally {
    detachAbort?.();
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    if (outputMedia) await releaseOwnedMedia(outputMedia);
    if (outputFile) await abortOutput();
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
