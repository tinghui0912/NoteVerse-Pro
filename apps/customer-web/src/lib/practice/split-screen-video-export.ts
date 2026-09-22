import {
  mediaTimeToPerformanceTimeMs,
  type PerformanceReviewDraft,
} from './performance-review-draft';
import { PracticeTempoTimeline } from './local-core/practice-tempo';
import type { PracticeVerovioAdapter } from './verovio-adapter';

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
  imageSignature: string | null;
  image: HTMLImageElement | null;
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
  try {
    pageNumber = adapter.getPageWithElement(entry.noteIds[0]) ?? 1;
  } catch {
    pageNumber = 1;
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
  const frameState: FrameRenderState = { imageSignature: null, image: null };

  try {
    video.src = objectUrl;
    video.preload = 'auto';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';

    await waitForVideoMetadata(video, signal);
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error('split_screen_export_failed:video_decode');
    }

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
    const result = new Promise<SplitScreenExportResult>((resolve, reject) => {
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

    const renderLoop = async () => {
      if (signal?.aborted) {
        stopRecorder();
        return;
      }
      if (video.ended) {
        await drawExportFrame({
          ctx,
          video,
          draft,
          scoreContainer,
          adapter,
          scoreEndBeat,
          frameState,
        });
        onProgress?.({
          mediaTimeMs: Math.max(0, video.currentTime * 1000),
          durationMs: Math.max(0, video.duration * 1000),
          ratio: 1,
        });
        stopRecorder();
        return;
      }

      await drawExportFrame({
        ctx,
        video,
        draft,
        scoreContainer,
        adapter,
        scoreEndBeat,
        frameState,
      });
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

    await drawExportFrame({
      ctx,
      video,
      draft,
      scoreContainer,
      adapter,
      scoreEndBeat,
      frameState,
    });
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

async function drawExportFrame({
  ctx,
  video,
  draft,
  scoreContainer,
  adapter,
  scoreEndBeat,
  frameState,
}: {
  ctx: CanvasRenderingContext2D;
  video: HTMLVideoElement;
  draft: PerformanceReviewDraft;
  scoreContainer: HTMLElement;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  frameState: FrameRenderState;
}) {
  const videoDraft = draft.video?.status === 'READY' ? draft.video : null;
  const frame = resolveSplitScreenScoreFrame({
    draft,
    adapter,
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

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, EXPORT_WIDTH, EXPORT_HEIGHT);

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

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, scoreRect.x, scoreRect.y, scoreRect.width, scoreRect.height, 10);
  ctx.fill();

  const scoreImage = await getScorePageImage({
    scoreContainer,
    pageNumber: frame.pageNumber,
    noteIds: frame.noteIds,
    frameState,
  });
  drawContain(ctx, scoreImage, scoreRect, '#ffffff');

  ctx.fillStyle = '#020617';
  roundRect(ctx, videoRect.x, videoRect.y, videoRect.width, videoRect.height, 10);
  ctx.fill();
  drawContain(ctx, video, videoRect, '#020617');
}

async function getScorePageImage({
  scoreContainer,
  pageNumber,
  noteIds,
  frameState,
}: {
  scoreContainer: HTMLElement;
  pageNumber: number;
  noteIds: readonly string[];
  frameState: FrameRenderState;
}): Promise<HTMLImageElement> {
  const signature = `${pageNumber}:${noteIds.join('\u001f')}`;
  if (frameState.image && frameState.imageSignature === signature) {
    return frameState.image;
  }

  const page = scoreContainer.querySelector<HTMLElement>(
    `[data-practice-review-page="${pageNumber}"]`
  );
  const svg = page?.querySelector<SVGSVGElement>('svg');
  if (!svg) {
    throw new Error('split_screen_export_failed:score_page_unavailable');
  }

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', clone.getAttribute('width') || String(svg.viewBox.baseVal.width || 1200));
  clone.setAttribute('height', clone.getAttribute('height') || String(svg.viewBox.baseVal.height || 1600));

  for (const noteId of noteIds) {
    const note =
      clone.querySelector<SVGElement>(`[data-id="${cssString(noteId)}"]`) ??
      clone.querySelector<SVGElement>(`#${escapeCssId(noteId)}`);
    note?.classList.add('practice-note-active');
  }

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `
    .practice-note-active,
    .practice-note-active * {
      fill: #f97316 !important;
      stroke: #ea580c !important;
      stroke-width: 2px !important;
      opacity: 1 !important;
    }
  `;
  clone.insertBefore(style, clone.firstChild);

  const svgText = new XMLSerializer().serializeToString(clone);
  const image = await loadImageFromSvg(svgText);
  frameState.imageSignature = signature;
  frameState.image = image;
  return image;
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

function loadImageFromSvg(svgText: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('split_screen_export_failed:score_image_decode'));
    };
    image.src = url;
  });
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  rect: { x: number; y: number; width: number; height: number },
  background: string
) {
  const sourceWidth =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : 'width' in source
          ? Number(source.width)
          : rect.width;
  const sourceHeight =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : 'height' in source
          ? Number(source.height)
          : rect.height;

  ctx.fillStyle = background;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }
  const scale = Math.min(rect.width / sourceWidth, rect.height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const x = rect.x + (rect.width - drawWidth) / 2;
  const y = rect.y + (rect.height - drawHeight) / 2;
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
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

function cssString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
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
