import {
  mediaTimeToPerformanceTimeMs,
  type PerformanceReviewDraft,
} from './performance-review-draft';
import { PracticeTempoTimeline } from './local-core/practice-tempo';
import { resolveSplitScreenScoreFrame as resolvePlaybackFrame } from './split-screen-playback-position';
import { renderSplitScreenFrameAtTime } from './split-screen-frame-renderer';
import {
  getShareVideoLayout,
  type ShareVideoTemplate,
} from './share-video-templates';
import {
  findStablePageNumber,
  prefetchEventScoreImage,
  prepareScorePageCache,
  resolveExportPlaybackGeometry,
  type ScorePageCache,
} from './split-screen-score-model';
import type { PracticeVerovioAdapter } from './verovio-adapter';

export {
  findStablePageNumber,
  firstScorePage,
  prepareScorePageCache,
  resolveExportPlaybackGeometry,
} from './split-screen-score-model';
export type {
  ExportNoteGeometry,
  ScorePageCache,
  ScorePageCacheEntry,
  ScorePageImageLoader,
  SvgViewBox,
} from './split-screen-score-model';

const EXPORT_FPS = 30;

const SPLIT_SCREEN_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export type SplitScreenExportReadiness =
  | { ok: true; mimeType: string }
  | { ok: false; reason: SplitScreenExportBlockReason };

export type SplitScreenExportBlockReason =
  | 'video_not_ready'
  | 'empty_video'
  | 'score_identity_mismatch'
  | 'score_not_ready'
  | 'timebase_unavailable'
  | 'media_recorder_unsupported'
  | 'canvas_capture_unsupported';

export type SplitScreenExportProgress = {
  mediaTimeMs: number;
  durationMs: number;
  ratio: number;
};

export type SplitScreenExportResult = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
};

export type ResolveSplitScreenFrameInput = {
  draft: PerformanceReviewDraft;
  adapter: Pick<
    PracticeVerovioAdapter,
    'getCursorTimelineEntryForBeatRange' | 'getPageWithElement'
  >;
  pageNumberResolver?: (noteIds: readonly string[]) => number | null;
  mediaTimeMs: number;
  actualMediaDurationMs?: number | null;
  scoreEndBeat: number;
};

export type SplitScreenScoreFrame = {
  perfTimeMs: number;
  musicalBeat: number;
  pageNumber: number;
  noteIds: string[];
};

export type SplitScreenExportOptions = {
  draft: PerformanceReviewDraft;
  scoreContainer: HTMLElement;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  signal?: AbortSignal;
  onProgress?: (progress: SplitScreenExportProgress) => void;
  template?: ShareVideoTemplate;
};

type FrameRenderState = {
  scorePages: ScorePageCache;
  stagingCanvas: HTMLCanvasElement;
  stagingCtx: CanvasRenderingContext2D;
};

export function selectSupportedSplitScreenMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') {
    return null;
  }
  if (typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  return SPLIT_SCREEN_MIME_CANDIDATES.find((candidate) =>
    MediaRecorder.isTypeSupported(candidate)
  ) ?? null;
}

export function getSplitScreenExportReadiness({
  draft,
  isScoreIdentityConfirmed,
  xmlContent,
  scoreContainer,
}: {
  draft: PerformanceReviewDraft | null;
  isScoreIdentityConfirmed: boolean;
  xmlContent: string | null;
  scoreContainer: HTMLElement | null;
}): SplitScreenExportReadiness {
  if (draft?.video?.status !== 'READY') {
    return { ok: false, reason: 'video_not_ready' };
  }
  if (draft.video.blob.size <= 0) {
    return { ok: false, reason: 'empty_video' };
  }
  if (!isScoreIdentityConfirmed) {
    return { ok: false, reason: 'score_identity_mismatch' };
  }
  if (!xmlContent || !scoreContainer) {
    return { ok: false, reason: 'score_not_ready' };
  }
  if (!draft.recordingTimebase?.activeSegments?.length) {
    return { ok: false, reason: 'timebase_unavailable' };
  }
  const mimeType = selectSupportedSplitScreenMimeType();
  if (!mimeType) {
    return { ok: false, reason: 'media_recorder_unsupported' };
  }
  if (!canCaptureCanvasStream()) {
    return { ok: false, reason: 'canvas_capture_unsupported' };
  }
  return { ok: true, mimeType };
}

export function resolveSplitScreenScoreFrame({
  draft,
  adapter,
  pageNumberResolver,
  mediaTimeMs,
  actualMediaDurationMs,
  scoreEndBeat,
}: ResolveSplitScreenFrameInput): SplitScreenScoreFrame | null {
  const perfTimeMs = mediaTimeToPerformanceTimeMs(
    mediaTimeMs,
    draft.recordingTimebase,
    actualMediaDurationMs
  );
  if (perfTimeMs === null) {
    return null;
  }

  const timeline = new PracticeTempoTimeline(draft.tempoPlan, scoreEndBeat);
  const scopeStartMs = draft.replayTiming?.scopeStartMs ?? 0;
  const musicalBeat = timeline.timeMsToBeat(scopeStartMs + perfTimeMs);
  const entry = adapter.getCursorTimelineEntryForBeatRange(
    musicalBeat,
    draft.scope.startBeat,
    draft.scope.terminalBeat
  );
  if (!entry || entry.noteIds.length === 0) {
    return null;
  }

  let pageNumber = 1;
  if (pageNumberResolver) {
    pageNumber = pageNumberResolver(entry.noteIds) ?? 1;
  } else {
    try {
      pageNumber = adapter.getPageWithElement(entry.noteIds[0]) ?? 1;
    } catch {
      pageNumber = 1;
    }
  }

  return {
    perfTimeMs,
    musicalBeat,
    pageNumber,
    noteIds: entry.noteIds,
  };
}

export function composeSplitScreenOutputStream(
  canvasStream: MediaStream,
  audioStream: MediaStream
): MediaStream {
  return new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioStream.getAudioTracks(),
  ]);
}

export async function exportSplitScreenPerformanceVideo({
  draft,
  scoreContainer,
  adapter,
  scoreEndBeat,
  signal,
  onProgress,
  template = { kind: 'landscape' },
}: SplitScreenExportOptions): Promise<SplitScreenExportResult> {
  const readiness = getSplitScreenExportReadiness({
    draft,
    isScoreIdentityConfirmed: true,
    xmlContent: 'ready',
    scoreContainer,
  });
  if (!readiness.ok) {
    throw new Error(`split_screen_export_unavailable:${readiness.reason}`);
  }
  if (draft.video?.status !== 'READY') {
    throw new Error('split_screen_export_unavailable:video_not_ready');
  }
  const sourceVideo = draft.video;
  const layout = getShareVideoLayout(template);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('split_screen_export_unavailable:canvas_context');
  }

  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(draft.video.blob);
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
      throw new Error('split_screen_export_failed:video_decode');
    }

    const scorePages = await prepareScorePageCache(scoreContainer);
    const stagingCanvas = document.createElement('canvas');
    stagingCanvas.width = layout.width;
    stagingCanvas.height = layout.height;
    const stagingCtx = stagingCanvas.getContext('2d');
    if (!stagingCtx) {
      throw new Error('split_screen_export_unavailable:canvas_context');
    }
    const frameState: FrameRenderState = {
      scorePages,
      stagingCanvas,
      stagingCtx,
    };

    await drawExportFrame({
      ctx,
      video,
      draft,
      adapter,
      scoreEndBeat,
      frameState,
      template,
    });
    await prefetchUpcomingEventImage({
      mediaTimeMs: Math.max(0, video.currentTime * 1000) + 400,
      video,
      draft,
      adapter,
      scoreEndBeat,
      scorePages,
    });

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error('split_screen_export_failed:audio_context_unavailable');
    }
    audioContext = new AudioContextCtor();
    const source = audioContext.createMediaElementSource(video);
    const audioDestination = audioContext.createMediaStreamDestination();
    source.connect(audioDestination);
    if (audioDestination.stream.getAudioTracks().length === 0) {
      throw new Error('split_screen_export_failed:audio_track_missing');
    }

    canvasStream = canvas.captureStream(EXPORT_FPS);
    outputStream = composeSplitScreenOutputStream(canvasStream, audioDestination.stream);
    if (outputStream.getAudioTracks().length === 0) {
      throw new Error('split_screen_export_failed:audio_track_missing');
    }

    const chunks: Blob[] = [];
    recorder = new MediaRecorder(outputStream, { mimeType: readiness.mimeType });
    let wasAborted = false;
    let rejectExport: ((reason?: unknown) => void) | null = null;
    const result = new Promise<SplitScreenExportResult>((resolve, reject) => {
      rejectExport = reject;
      recorder!.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };
      recorder!.onerror = () => reject(new Error('split_screen_export_failed:encoding'));
      recorder!.onstop = () => {
        if (wasAborted || signal?.aborted) {
          reject(new DOMException('Export cancelled', 'AbortError'));
          return;
        }
        const blob = new Blob(chunks, { type: readiness.mimeType });
        if (blob.size <= 0) {
          reject(new Error('split_screen_export_failed:empty_output'));
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
            draft,
            adapter,
            scoreEndBeat,
            frameState,
            template,
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
          draft,
          adapter,
          scoreEndBeat,
          frameState,
          template,
        });
        const frameWaitMs = performance.now() - frameStartedAt;
        if (frameWaitMs > 250) {
          failExport(new Error('split_screen_export_failed:frame_prepare_timeout'));
          return;
        }
        void prefetchUpcomingEventImage({
          mediaTimeMs: Math.max(0, video.currentTime * 1000) + 400,
          video,
          draft,
          adapter,
          scoreEndBeat,
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
  draft,
  adapter,
  scoreEndBeat,
  scorePages,
}: {
  mediaTimeMs: number;
  video: HTMLVideoElement;
  draft: PerformanceReviewDraft;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  scorePages: ScorePageCache;
}) {
  const position = resolvePlaybackFrame({
    draft,
    adapter,
    pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, scorePages),
    mediaTimeMs,
    actualMediaDurationMs: safeDurationMs(video),
    scoreEndBeat,
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
  draft,
  adapter,
  scoreEndBeat,
  frameState,
  template = { kind: 'landscape' },
}: {
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  draft: PerformanceReviewDraft;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  frameState: FrameRenderState;
  template?: ShareVideoTemplate;
}): Promise<void> {
  const videoDraft = draft.video?.status === 'READY' ? draft.video : null;
  const layout = getShareVideoLayout(template);

  await renderSplitScreenFrameAtTime({
    mediaTimeMs: Math.max(0, video.currentTime * 1000),
    scoreModel: frameState.scorePages,
    playbackTimeline: {
      resolve: (mediaTimeMs) => resolvePlaybackFrame({
        draft,
        adapter,
        pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, frameState.scorePages),
        mediaTimeMs,
        actualMediaDurationMs:
          videoDraft
            ? videoDraft.actualMediaDurationMs ?? safeDurationMs(video)
            : safeDurationMs(video),
        scoreEndBeat,
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
      reject(new Error('split_screen_export_failed:video_decode'));
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
      reject(new Error('split_screen_export_failed:video_decode'));
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

/*
function rectsIntersect(first: Rect, second: Rect) {
  return (
    first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y
  );
}

function offscreenReason(first: Rect, second: Rect) {
  if (!isFiniteRect(first)) {
    return 'cursor_canvas_rect_invalid';
  }
  if (first.x + first.width <= second.x) return 'x_before_viewport';
  if (first.x >= second.x + second.width) return 'x_after_viewport';
  if (first.y + first.height <= second.y) return 'y_before_viewport';
  if (first.y >= second.y + second.height) return 'y_after_viewport';
  return 'unknown_offscreen';
}

function createSplitScreenExportError(
  message: string,
  context: {
    frame: SplitScreenScoreFrame;
    scorePage: ScorePageCacheEntry;
    cursorGeometry?: ExportCursorGeometry;
    viewport?: SvgRect;
    imageRect?: Rect;
    cursorBox?: Rect;
    noteBox?: Rect;
    reason: string | PlayheadCursorGeometryFailureReason;
  }
) {
  const error = new Error(message) as Error & { diagnostic?: unknown };
  error.diagnostic = splitScreenDiagnostic(context);
  logSplitScreenDiagnosticOnce(error.diagnostic);
  return error;
}

let didLogSplitScreenDiagnostic = false;

function logSplitScreenDiagnosticOnce(diagnostic: unknown) {
  if (didLogSplitScreenDiagnostic || typeof globalThis.console === 'undefined') {
    return;
  }
  didLogSplitScreenDiagnostic = true;
  if (process.env.NODE_ENV !== 'production') {
    globalThis.console.error(
      `[NoteVerse split-screen export diagnostic] ${stringifyDiagnostic(diagnostic)}`
    );
  }
}

function stringifyDiagnostic(diagnostic: unknown) {
  try {
    return JSON.stringify(diagnostic, null, 2);
  } catch {
    return String(diagnostic);
  }
}

function splitScreenDiagnostic({
  frame,
  scorePage,
  cursorGeometry,
  viewport,
  imageRect,
  cursorBox,
  noteBox,
  reason,
}: {
  frame: SplitScreenScoreFrame;
  scorePage: ScorePageCacheEntry;
  cursorGeometry?: ExportCursorGeometry;
  viewport?: SvgRect;
  imageRect?: Rect;
  cursorBox?: Rect;
  noteBox?: Rect;
  reason: string | PlayheadCursorGeometryFailureReason;
}) {
  return {
    reason,
    mediaFrame: {
      perfTimeMs: frame.perfTimeMs,
      musicalBeat: frame.musicalBeat,
      pageNumber: frame.pageNumber,
      noteIds: frame.noteIds,
    },
    scorePage: {
      pageNumber: scorePage.pageNumber,
      viewBox: scorePage.viewBox,
      geometryNoteCount: scorePage.geometryByNoteId.size,
      measureCount: scorePage.measureCount,
    },
    geometry: cursorGeometry
      ? {
          activeColumn: cursorGeometry.playback.activeColumn,
          anchorNoteId: cursorGeometry.playback.anchorNote.noteId,
          anchorNoteBox: cursorGeometry.playback.anchorNote.noteBox,
          staffId: cursorGeometry.playback.anchorNote.staffId,
          systemId: cursorGeometry.playback.anchorNote.systemId,
          viewport: cursorGeometry.playback.system.viewport,
        }
      : null,
    viewport,
    imageRect,
    cursorBox,
    noteBox,
  };
}

function isFiniteRect(rect: Rect) {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

*/

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
