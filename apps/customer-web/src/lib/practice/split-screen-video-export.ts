import {
  mediaTimeToPerformanceTimeMs,
  type PerformanceReviewDraft,
} from './performance-review-draft';
import { PracticeTempoTimeline } from './local-core/practice-tempo';
import {
  PLAYHEAD_CURSOR_STYLE,
  type PlayheadCursorGeometrySnapshot,
  type PlayheadCursorGeometryFailureReason,
  type SvgRect,
} from './playhead-cursor';
import {
  exportCursorRect as computeExportCursorRect,
  scoreViewportForLine,
} from './split-screen-score-camera';
import { resolveSplitScreenScoreFrame as resolvePlaybackFrame } from './split-screen-playback-position';
import {
  drawSourceVideoContain,
  drawStableScoreImage,
} from './split-screen-frame-renderer';
import {
  findStablePageNumber,
  firstScorePage,
  mergeExportNoteGeometries,
  prepareScorePageCache,
  type ExportNoteGeometry,
  type ScorePageCache,
  type ScorePageCacheEntry,
} from './split-screen-score-model';
import type { PracticeVerovioAdapter } from './verovio-adapter';

export {
  findStablePageNumber,
  firstScorePage,
  mergeExportNoteGeometries,
  prepareScorePageCache,
} from './split-screen-score-model';
export type {
  ExportNoteGeometry,
  ScorePageCache,
  ScorePageCacheEntry,
  ScorePageImageLoader,
  SvgViewBox,
} from './split-screen-score-model';

const EXPORT_WIDTH = 1280;
const EXPORT_HEIGHT = 720;
const EXPORT_FPS = 30;
const SCORE_WIDTH = 704;
const PANEL_GAP = 24;
const PADDING = 24;

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
};

type FrameRenderState = {
  scorePages: ScorePageCache;
  stagingCanvas: HTMLCanvasElement;
  stagingCtx: CanvasRenderingContext2D;
  viewportByLineKey?: Map<string, SvgRect>;
};

type ExportCursorGeometry = {
  activeNoteBox: SvgRect;
  lineBox: SvgRect;
  rootCoordinateSource: PlayheadCursorGeometrySnapshot['rootCoordinateSource'];
};

export function exportCursorRect(
  activeNoteBox: SvgRect,
  viewport: SvgRect,
  imageRect: Rect,
  paddingPx = 5
): Rect {
  return computeExportCursorRect(activeNoteBox, viewport, imageRect, paddingPx) as Rect;
}

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

  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_WIDTH;
  canvas.height = EXPORT_HEIGHT;
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
    stagingCanvas.width = EXPORT_WIDTH;
    stagingCanvas.height = EXPORT_HEIGHT;
    const stagingCtx = stagingCanvas.getContext('2d');
    if (!stagingCtx) {
      throw new Error('split_screen_export_unavailable:canvas_context');
    }
    const frameState: FrameRenderState = {
      scorePages,
      stagingCanvas,
      stagingCtx,
      viewportByLineKey: new Map(),
    };

    drawExportFrame({
      ctx,
      video,
      draft,
      adapter,
      scoreEndBeat,
      frameState,
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

    const renderLoop = () => {
      if (signal?.aborted) {
        stopRecorder();
        return;
      }
      if (video.ended) {
        try {
          drawExportFrame({
            ctx,
            video,
            draft,
            adapter,
            scoreEndBeat,
            frameState,
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
        drawExportFrame({
          ctx,
          video,
          draft,
          adapter,
          scoreEndBeat,
          frameState,
        });
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
        renderLoop();
      });
    };

    frameId = window.requestAnimationFrame(() => {
      renderLoop();
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

export function drawExportFrame({
  ctx,
  video,
  draft,
  adapter,
  scoreEndBeat,
  frameState,
}: {
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  draft: PerformanceReviewDraft;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  frameState: FrameRenderState;
}) {
  const videoDraft = draft.video?.status === 'READY' ? draft.video : null;
  let frame = resolvePlaybackFrame({
    draft,
    adapter,
    pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, frameState.scorePages),
    mediaTimeMs: Math.max(0, video.currentTime * 1000),
    actualMediaDurationMs:
      videoDraft
        ? videoDraft.actualMediaDurationMs ?? safeDurationMs(video)
        : safeDurationMs(video),
    scoreEndBeat,
  });
  if (!frame) {
    throw new Error('split_screen_export_failed:timebase_unavailable');
  }

  const scoreRect = {
    x: PADDING,
    y: PADDING,
    width: SCORE_WIDTH,
    height: EXPORT_HEIGHT - PADDING * 2,
  };
  const videoRect = {
    x: PADDING + SCORE_WIDTH + PANEL_GAP,
    y: PADDING,
    width: EXPORT_WIDTH - PADDING * 2 - SCORE_WIDTH - PANEL_GAP,
    height: EXPORT_HEIGHT - PADDING * 2,
  };

  const scorePage = frameState.scorePages.get(frame.pageNumber);
  const stablePageNumber = findStablePageNumber(frame.noteIds, frameState.scorePages);
  if (stablePageNumber === null) {
    throw createSplitScreenExportError('split_screen_export_failed:note_page_unavailable', {
      frame,
      scorePage: scorePage ?? firstScorePage(frameState.scorePages),
      reason: 'note_missing_from_snapshot',
    });
  }
  if (stablePageNumber !== frame.pageNumber) {
    frame = { ...frame, pageNumber: stablePageNumber };
  }
  const stableScorePage = frameState.scorePages.get(frame.pageNumber);
  if (!stableScorePage) {
    throw new Error('split_screen_export_failed:score_page_unavailable');
  }

  const staging = frameState.stagingCtx;
  staging.fillStyle = '#0f172a';
  staging.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

  staging.fillStyle = '#ffffff';
  roundRect(staging, scoreRect.x, scoreRect.y, scoreRect.width, scoreRect.height, 10);
  staging.fill();
  const snapshotGeometries = frame.noteIds.map((noteId) =>
    stableScorePage.geometryByNoteId.get(noteId)
  );
  if (snapshotGeometries.some((geometry) => geometry === undefined)) {
    throw createSplitScreenExportError(
      'split_screen_export_failed:playhead_note_not_found_on_snapshot',
      {
        frame,
        scorePage: stableScorePage,
        reason: 'note_missing_from_snapshot',
      }
    );
  }
  if (snapshotGeometries.some((geometry) => geometry === null)) {
    throw createSplitScreenExportError(
      'split_screen_export_failed:playhead_coordinate_transform',
      {
        frame,
        scorePage: stableScorePage,
        reason: 'snapshot_geometry_unavailable',
      }
    );
  }
  const cursorGeometry = mergeExportNoteGeometries(
    snapshotGeometries as ExportNoteGeometry[]
  );
  if (!cursorGeometry) {
    throw createSplitScreenExportError('split_screen_export_failed:playhead_position_unavailable', {
      frame,
      scorePage: stableScorePage,
      reason: 'snapshot_geometry_merge_failed',
    });
  }
  drawScorePanel(staging, stableScorePage, cursorGeometry, scoreRect, frame, frameState);

  staging.fillStyle = '#020617';
  roundRect(staging, videoRect.x, videoRect.y, videoRect.width, videoRect.height, 10);
  staging.fill();
  drawSourceVideoContain(staging, video, videoRect, '#020617');

  ctx.drawImage(frameState.stagingCanvas, 0, 0);
}

function drawScorePanel(
  ctx: CanvasRenderingContext2D,
  page: ScorePageCacheEntry,
  cursorGeometry: ExportCursorGeometry,
  scoreRect: Rect,
  frame: SplitScreenScoreFrame,
  frameState: FrameRenderState
) {
  const pageRect = {
    x: page.viewBox.x,
    y: page.viewBox.y,
    width: page.viewBox.width,
    height: page.viewBox.height,
  };
  if (!rectsIntersect(cursorGeometry.activeNoteBox, pageRect)) {
    throw createSplitScreenExportError('split_screen_export_failed:playhead_position_outside_page', {
      frame,
      scorePage: page,
      cursorGeometry,
      reason: 'note_box_outside_page',
    });
  }
  const viewport = scoreViewportForLine({
    viewBox: page.viewBox,
    lineBox: cursorGeometry.lineBox,
    activeNoteBox: cursorGeometry.activeNoteBox,
    viewportByLineKey: frameState.viewportByLineKey ?? (frameState.viewportByLineKey = new Map()),
    lineKey: `${page.pageNumber}:${Math.round(cursorGeometry.lineBox.y)}:${Math.round(cursorGeometry.lineBox.height)}`,
  });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(scoreRect.x, scoreRect.y, scoreRect.width, scoreRect.height);
  const imageRect = drawStableScoreImage(
    ctx,
    page.image,
    page.viewBox,
    viewport,
    scoreRect,
    false
  );
  const noteBox = svgRectToCanvasRect(cursorGeometry.activeNoteBox, viewport, imageRect);
  const cursorBox = exportCursorRect(cursorGeometry.activeNoteBox, viewport, imageRect);
  if (!rectsIntersect(noteBox, imageRect)) {
    throw createSplitScreenExportError('split_screen_export_failed:playhead_position_offscreen', {
      frame,
      scorePage: page,
      cursorGeometry,
      viewport,
      imageRect,
      cursorBox,
      noteBox,
      reason: offscreenReason(noteBox, imageRect),
    });
  }

  ctx.save();
  ctx.fillStyle = PLAYHEAD_CURSOR_STYLE.fill;
  ctx.strokeStyle = PLAYHEAD_CURSOR_STYLE.stroke;
  ctx.lineWidth = Math.max(1.5, imageRect.width / 520);
  ctx.shadowColor = PLAYHEAD_CURSOR_STYLE.shadow;
  ctx.shadowBlur = 7;
  roundRect(
    ctx,
    cursorBox.x,
    cursorBox.y,
    cursorBox.width,
    cursorBox.height,
    Math.max(4, Math.min(10, cursorBox.width / 4))
  );
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawStableScoreImage(ctx, page.image, page.viewBox, viewport, scoreRect, true);
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

function svgRectToCanvasRect(rect: SvgRect, viewport: SvgRect, imageRect: Rect): Rect {
  const scaleX = imageRect.width / viewport.width;
  const scaleY = imageRect.height / viewport.height;
  return {
    x: imageRect.x + (rect.x - viewport.x) * scaleX,
    y: imageRect.y + (rect.y - viewport.y) * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

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
          activeNoteBox: cursorGeometry.activeNoteBox,
          lineBox: cursorGeometry.lineBox,
          rootCoordinateSource: cursorGeometry.rootCoordinateSource,
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

type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
