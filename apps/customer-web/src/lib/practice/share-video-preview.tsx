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

type PreviewStatus = 'idle' | 'preparing' | 'ready' | 'error';

type PreviewRequest = {
  mediaTimeMs: number;
  template: ShareVideoTemplate;
  templateVersion: number;
};

type RenderableVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: { mediaTime: number }) => void
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * The preview is a view of the replay player's video element. It never owns
 * media playback, seeks, audio, or an object URL of its own.
 */
export function ShareVideoPreview({
  draft,
  scoreContainer,
  adapter,
  scoreEndBeat,
  mediaTimeMs,
  template,
  isReplayPlaying = false,
  replayVideo,
  onFrameCommitted,
}: {
  draft: PerformanceReviewDraft;
  scoreContainer: HTMLElement | null;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  mediaTimeMs: number;
  template: ShareVideoTemplate;
  isReplayPlaying?: boolean;
  replayVideo: HTMLVideoElement | null;
  onFrameCommitted?: (mediaTimeMs: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stagingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scorePagesRef = useRef<ScorePageCache | null>(null);
  const pendingRequestRef = useRef<PreviewRequest | null>(null);
  const activeRenderRef = useRef(false);
  const templateVersionRef = useRef(0);
  const frameCallbackRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const disposedRef = useRef(false);
  const isPlayingRef = useRef(isReplayPlaying);
  const templateRef = useRef(template);
  const mediaTimeRef = useRef(mediaTimeMs);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resourceVersion, setResourceVersion] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const isDebugPreviewExportEnabled = process.env.NODE_ENV !== 'production';

  useEffect(() => {
    mediaTimeRef.current = mediaTimeMs;
  }, [mediaTimeMs]);

  const handleSavePreviewPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width <= 0 || canvas.height <= 0) return;
    const url = canvas.toDataURL('image/png');
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `noteverse-share-preview-${Date.now()}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, []);

  const clearFrameScheduler = useCallback(() => {
    const video = replayVideo as RenderableVideo | null;
    if (frameCallbackRef.current !== null) {
      video?.cancelVideoFrameCallback?.(frameCallbackRef.current);
      frameCallbackRef.current = null;
    }
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, [replayVideo]);

  const commitStagingFrame = useCallback((layout: ReturnType<typeof getShareVideoLayout>) => {
    const visibleCanvas = canvasRef.current;
    const stagingCanvas = stagingCanvasRef.current;
    if (!visibleCanvas || !stagingCanvas || disposedRef.current) return;
    if (visibleCanvas.width !== layout.width || visibleCanvas.height !== layout.height) {
      visibleCanvas.width = layout.width;
      visibleCanvas.height = layout.height;
    }
    const context = visibleCanvas.getContext('2d');
    if (!context) throw new Error('分享视频预览无法创建显示画布');
    context.drawImage(stagingCanvas, 0, 0);
  }, []);

  const drainPreviewQueue = useCallback(async () => {
    if (activeRenderRef.current || disposedRef.current) return;
    activeRenderRef.current = true;
    try {
      while (!disposedRef.current && pendingRequestRef.current) {
        const request = pendingRequestRef.current;
        pendingRequestRef.current = null;
        const scorePages = scorePagesRef.current;
        const sourceVideo = replayVideo;
        const stagingCanvas = stagingCanvasRef.current;
        if (!scorePages || !sourceVideo || !stagingCanvas) continue;

        const layout = getShareVideoLayout(request.template);
        if (stagingCanvas.width !== layout.width || stagingCanvas.height !== layout.height) {
          stagingCanvas.width = layout.width;
          stagingCanvas.height = layout.height;
        }

        try {
          if (!isPlayingRef.current) {
            await waitForReplayVideoFrame(sourceVideo);
          }
          await renderSplitScreenFrameAtTime({
            mediaTimeMs: sourceVideo.currentTime * 1000,
            scoreModel: scorePages,
            playbackTimeline: {
              resolve: (timeMs) =>
                resolveSplitScreenScoreFrame({
                  draft,
                  adapter,
                  pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, scorePages),
                  mediaTimeMs: timeMs,
                  actualMediaDurationMs:
                    Number.isFinite(sourceVideo.duration) && sourceVideo.duration > 0
                      ? sourceVideo.duration * 1000
                      : draft.video && 'durationMs' in draft.video
                        ? draft.video.durationMs
                        : null,
                  scoreEndBeat,
                }),
            },
            sourceVideoFrame: sourceVideo,
            outputCanvas: stagingCanvas,
            layout,
          });

          const requestIsCurrent =
            !pendingRequestRef.current &&
            request.templateVersion === templateVersionRef.current;
          if (!requestIsCurrent || disposedRef.current) continue;

          commitStagingFrame(layout);
          onFrameCommitted?.(sourceVideo.currentTime * 1000);
          setError(null);
          setStatus('ready');
        } catch (cause) {
          if (
            request.templateVersion !== templateVersionRef.current ||
            disposedRef.current ||
            pendingRequestRef.current
          ) {
            continue;
          }
          setError(cause instanceof Error ? cause.message : '分享视频预览失败');
          setStatus('error');
        }
      }
    } finally {
      activeRenderRef.current = false;
    }
  }, [adapter, commitStagingFrame, draft, onFrameCommitted, replayVideo, scoreEndBeat]);

  const enqueuePreview = useCallback(
    (nextTimeMs: number) => {
      if (disposedRef.current || !replayVideo || !scorePagesRef.current) return;
      pendingRequestRef.current = {
        mediaTimeMs: Math.max(0, nextTimeMs),
        template: templateRef.current,
        templateVersion: templateVersionRef.current,
      };
      void drainPreviewQueue();
    },
    [drainPreviewQueue, replayVideo]
  );

  useEffect(() => {
    disposedRef.current = false;
    scorePagesRef.current = null;
    pendingRequestRef.current = null;
    let cancelled = false;
    const prepare = async () => {
      setStatus('preparing');
      setError(null);
      if (!scoreContainer || draft.video?.status !== 'READY') {
        setStatus('idle');
        return;
      }
      try {
        const scorePages = await prepareScorePageCache(scoreContainer, undefined, {
          visualMode: template.kind === 'floating' ? 'floating' : 'standard',
        });
        if (cancelled || disposedRef.current) return;
        scorePagesRef.current = scorePages;
        setStatus('ready');
        setResourceVersion((version) => version + 1);
      } catch (cause) {
        if (!cancelled && !disposedRef.current) {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : '分享视频预览无法准备乐谱');
        }
      }
    };
    void prepare();

    return () => {
      cancelled = true;
      disposedRef.current = true;
      pendingRequestRef.current = null;
      clearFrameScheduler();
      const scorePages = scorePagesRef.current;
      scorePagesRef.current = null;
      if (scorePages) {
        for (const page of scorePages.values()) {
          page.eventImages.clear();
          page.eventImagePromises.clear();
        }
        scorePages.clear();
      }
    };
  }, [
    clearFrameScheduler,
    draft,
    retryNonce,
    scoreContainer,
    template.kind,
  ]);

  useEffect(() => {
    if (JSON.stringify(templateRef.current) !== JSON.stringify(template)) {
      templateVersionRef.current += 1;
    }
    templateRef.current = template;
    if (status === 'ready') {
      enqueuePreview(
        replayVideo?.currentTime ? replayVideo.currentTime * 1000 : mediaTimeMs
      );
    }
  }, [enqueuePreview, mediaTimeMs, replayVideo, resourceVersion, status, template]);

  useEffect(() => {
    isPlayingRef.current = isReplayPlaying;
    clearFrameScheduler();
    if (!isReplayPlaying || status !== 'ready' || !replayVideo) {
      if (!isReplayPlaying && status === 'ready') {
        enqueuePreview(
          replayVideo?.currentTime ? replayVideo.currentTime * 1000 : mediaTimeRef.current
        );
      }
      return;
    }

    const video = replayVideo as RenderableVideo;
    const renderCurrentFrame = () => {
      if (disposedRef.current || !isPlayingRef.current || !replayVideo) return;
      enqueuePreview(replayVideo.currentTime * 1000);
    };

    if (typeof video.requestVideoFrameCallback === 'function') {
      const onVideoFrame = () => {
        renderCurrentFrame();
        if (!disposedRef.current && isPlayingRef.current) {
          frameCallbackRef.current = video.requestVideoFrameCallback(onVideoFrame);
        }
      };
      frameCallbackRef.current = video.requestVideoFrameCallback(onVideoFrame);
    } else {
      const tick = () => {
        renderCurrentFrame();
        if (!disposedRef.current && isPlayingRef.current) {
          animationFrameRef.current = window.requestAnimationFrame(tick);
        }
      };
      animationFrameRef.current = window.requestAnimationFrame(tick);
    }

    return clearFrameScheduler;
  }, [
    clearFrameScheduler,
    enqueuePreview,
    isReplayPlaying,
    replayVideo,
    status,
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
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>分享预览与回放同步，不改变原始演奏录像。</p>
          {isDebugPreviewExportEnabled ? (
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={handleSavePreviewPng}
            >
              保存当前预览 PNG
            </button>
          ) : null}
        </div>
      ) : null}
      {status === 'error' ? (
        <div className="flex items-center justify-between gap-3 text-xs text-destructive">
          <p>{error ?? '分享视频预览失败'}</p>
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

function waitForReplayVideoFrame(video: HTMLVideoElement): Promise<void> {
  if (!video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('分享视频预览无法解码当前回放画面'));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onReady);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onReady, { once: true });
    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
  });
}
