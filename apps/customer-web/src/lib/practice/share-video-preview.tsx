'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PerformanceReviewDraft } from './performance-review-draft';
import { renderSplitScreenFrameAtTime } from './split-screen-frame-renderer';
import {
  findStablePageNumber,
  prepareScorePageCache,
  type ScorePageCache,
} from './split-screen-score-model';
import { resolveSplitScreenScoreFrame } from './split-screen-playback-position';
import { getShareVideoLayout, type ShareVideoTemplate } from './share-video-templates';
import type { PracticeVerovioAdapter } from './verovio-adapter';

type PreviewResources = {
  video: HTMLVideoElement;
  objectUrl: string;
  scorePages: ScorePageCache;
  durationMs: number;
};

type PreviewStatus = 'idle' | 'preparing' | 'ready' | 'error';

type PreviewRequest = {
  id: number;
  mediaTimeMs: number;
  template: ShareVideoTemplate;
};

export function ShareVideoPreview({
  draft,
  scoreContainer,
  adapter,
  scoreEndBeat,
  mediaTimeMs,
  template,
  isReplayPlaying = false,
}: {
  draft: PerformanceReviewDraft;
  scoreContainer: HTMLElement | null;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  mediaTimeMs: number;
  template: ShareVideoTemplate;
  isReplayPlaying?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stagingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const resourcesRef = useRef<PreviewResources | null>(null);
  const pendingRequestRef = useRef<PreviewRequest | null>(null);
  const activeRenderRef = useRef(false);
  const requestIdRef = useRef(0);
  const disposedRef = useRef(false);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resourceVersion, setResourceVersion] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let disposed = false;
    disposedRef.current = false;
    const canvas = canvasRef.current;
    if (!canvas || !scoreContainer || draft.video?.status !== 'READY') {
      setStatus('idle');
      return;
    }

    const videoDraft = draft.video;
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(videoDraft.blob);
    setStatus('preparing');
    setError(null);

    const prepare = async () => {
      try {
        video.src = objectUrl;
        video.preload = 'auto';
        video.playsInline = true;
        await waitForPreviewVideo(video);
        if (disposed) return;
        const durationMs = Number.isFinite(video.duration)
          ? video.duration * 1000
          : videoDraft.durationMs;
        const scorePages = await prepareScorePageCache(scoreContainer);
        if (disposed) return;
        resourcesRef.current = { video, objectUrl, scorePages, durationMs };
        setStatus('ready');
        setResourceVersion((version) => version + 1);
      } catch (cause) {
        if (!disposed) {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : '分享视频预览无法准备');
        }
      } finally {
        if (disposed || !resourcesRef.current) {
          disposePreviewResources({ video, objectUrl, scorePages: null });
        }
      }
    };

    void prepare();
    return () => {
      disposed = true;
      disposedRef.current = true;
      requestIdRef.current += 1;
      pendingRequestRef.current = null;
      const resources = resourcesRef.current;
      resourcesRef.current = null;
      disposePreviewResources(resources ?? { video, objectUrl, scorePages: null });
    };
  }, [adapter, draft, scoreContainer, scoreEndBeat]);

  const commitStagingFrame = useCallback((layout: ReturnType<typeof getShareVideoLayout>) => {
    const visibleCanvas = canvasRef.current;
    const stagingCanvas = stagingCanvasRef.current;
    if (!visibleCanvas || !stagingCanvas || disposedRef.current) return;
    if (visibleCanvas.width !== layout.width || visibleCanvas.height !== layout.height) {
      visibleCanvas.width = layout.width;
      visibleCanvas.height = layout.height;
    }
    const visibleContext = visibleCanvas.getContext('2d');
    if (!visibleContext) throw new Error('分享视频预览无法创建显示画布');
    visibleContext.drawImage(stagingCanvas, 0, 0);
  }, []);

  const drainPreviewQueue = useCallback(async () => {
    if (activeRenderRef.current || disposedRef.current || isReplayPlaying) return;
    activeRenderRef.current = true;
    try {
      while (!disposedRef.current && !isReplayPlaying && pendingRequestRef.current) {
        const request = pendingRequestRef.current;
        pendingRequestRef.current = null;
        const resources = resourcesRef.current;
        const stagingCanvas = stagingCanvasRef.current;
        if (!resources || !stagingCanvas) continue;
        const layout = getShareVideoLayout(request.template);
        if (stagingCanvas.width !== layout.width || stagingCanvas.height !== layout.height) {
          stagingCanvas.width = layout.width;
          stagingCanvas.height = layout.height;
        }
        try {
          const timeSeconds = Math.min(
            Math.max(0, request.mediaTimeMs / 1000),
            Math.max(0, resources.durationMs / 1000 - 0.001)
          );
          await seekPreviewVideo(resources.video, timeSeconds);
          if (
            disposedRef.current ||
            isReplayPlaying ||
            request.id !== requestIdRef.current ||
            pendingRequestRef.current
          ) {
            continue;
          }
          await renderSplitScreenFrameAtTime({
            mediaTimeMs: resources.video.currentTime * 1000,
            scoreModel: resources.scorePages,
            playbackTimeline: {
              resolve: (timeMs) =>
                resolveSplitScreenScoreFrame({
                  draft,
                  adapter,
                  pageNumberResolver: (noteIds) =>
                    findStablePageNumber(noteIds, resources.scorePages),
                  mediaTimeMs: timeMs,
                  actualMediaDurationMs: resources.durationMs,
                  scoreEndBeat,
                }),
            },
            sourceVideoFrame: resources.video,
            outputCanvas: stagingCanvas,
            layout,
          });
          if (
            disposedRef.current ||
            isReplayPlaying ||
            request.id !== requestIdRef.current ||
            pendingRequestRef.current
          ) {
            continue;
          }
          commitStagingFrame(layout);
          setError(null);
        } catch (cause) {
          if (
            !disposedRef.current &&
            !isReplayPlaying &&
            request.id === requestIdRef.current &&
            !pendingRequestRef.current
          ) {
            setError(cause instanceof Error ? cause.message : '分享视频预览失败');
            setStatus('ready');
          }
        }
      }
    } finally {
      activeRenderRef.current = false;
    }
  }, [adapter, commitStagingFrame, draft, isReplayPlaying, scoreEndBeat]);

  useEffect(() => {
    if (isReplayPlaying) {
      requestIdRef.current += 1;
      pendingRequestRef.current = null;
      return;
    }
    if (status !== 'ready' || !resourcesRef.current) return;
    requestIdRef.current += 1;
    pendingRequestRef.current = {
      id: requestIdRef.current,
      mediaTimeMs,
      template,
    };
    void drainPreviewQueue();
  }, [
    drainPreviewQueue,
    isReplayPlaying,
    mediaTimeMs,
    resourceVersion,
    retryNonce,
    status,
    template,
  ]);

  return (
    <div className="space-y-2">
      <div className="flex min-h-0 w-full items-center justify-center overflow-hidden rounded-md border border-border bg-slate-950 p-2">
        <canvas
          ref={canvasRef}
          className="block h-auto max-h-[min(55dvh,480px)] max-w-full w-auto"
          aria-label="当前时间点画面预览"
        />
        <canvas ref={stagingCanvasRef} className="hidden" aria-hidden="true" />
      </div>
      {status === 'preparing' ? (
        <p className="text-xs text-muted-foreground">预览准备中...</p>
      ) : null}
      {status === 'ready' && !error ? (
        <p className="text-xs text-muted-foreground">
          当前时间点的版式预览，可在回放暂停或定位后更新。
        </p>
      ) : null}
      {error ? (
        <div className="flex items-center justify-between gap-3 text-xs text-destructive">
          <p>{error}</p>
          <button
            type="button"
            className="shrink-0 underline underline-offset-2"
            onClick={() => setRetryNonce((nonce) => nonce + 1)}
          >
            重试预览
          </button>
        </div>
      ) : null}
    </div>
  );
}

function disposePreviewResources(resources: {
  video: HTMLVideoElement;
  objectUrl: string;
  scorePages: ScorePageCache | null;
}) {
  resources.video.pause();
  resources.video.removeAttribute('src');
  resources.video.load();
  URL.revokeObjectURL(resources.objectUrl);
  if (resources.scorePages) {
    for (const page of resources.scorePages.values()) {
      page.eventImages.clear();
      page.eventImagePromises.clear();
    }
    resources.scorePages.clear();
  }
}

function waitForPreviewVideo(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('分享视频预览无法解码原始录像'));
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.removeEventListener('canplay', onLoaded);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('loadeddata', onLoaded, { once: true });
    video.addEventListener('canplay', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}

function seekPreviewVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  if (Math.abs(video.currentTime - timeSeconds) < 0.001) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('分享视频预览无法定位到指定时间'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = timeSeconds;
  });
}
