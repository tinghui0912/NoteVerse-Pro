'use client';

import { useEffect, useRef, useState } from 'react';

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

export function ShareVideoPreview({
  draft,
  scoreContainer,
  adapter,
  scoreEndBeat,
  mediaTimeMs,
  template,
}: {
  draft: PerformanceReviewDraft;
  scoreContainer: HTMLElement | null;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  mediaTimeMs: number;
  template: ShareVideoTemplate;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const resourcesRef = useRef<PreviewResources | null>(null);
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<PreviewStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resourceVersion, setResourceVersion] = useState(0);

  useEffect(() => {
    let disposed = false;
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
      requestIdRef.current += 1;
      const resources = resourcesRef.current;
      resourcesRef.current = null;
      disposePreviewResources(resources ?? { video, objectUrl, scorePages: null });
    };
  }, [adapter, draft, scoreContainer, scoreEndBeat]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const resources = resourcesRef.current;
    if (!canvas || !resources || status !== 'ready') return;

    const requestId = ++requestIdRef.current;
    const layout = getShareVideoLayout(template);
    canvas.width = layout.width;
    canvas.height = layout.height;

    const render = async () => {
      try {
        const timeSeconds = Math.min(
          Math.max(0, mediaTimeMs / 1000),
          Math.max(0, resources.durationMs / 1000 - 0.001)
        );
        await seekPreviewVideo(resources.video, timeSeconds);
        if (requestId !== requestIdRef.current) return;
        await renderSplitScreenFrameAtTime({
          mediaTimeMs: resources.video.currentTime * 1000,
          scoreModel: resources.scorePages,
          playbackTimeline: {
            resolve: (timeMs) =>
              resolveSplitScreenScoreFrame({
                draft,
                adapter,
                pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, resources.scorePages),
                mediaTimeMs: timeMs,
                actualMediaDurationMs: resources.durationMs,
                scoreEndBeat,
              }),
          },
          sourceVideoFrame: resources.video,
          outputCanvas: canvas,
          layout,
        });
        if (requestId === requestIdRef.current) {
          setError(null);
        }
      } catch (cause) {
        if (requestId === requestIdRef.current) {
          setStatus('error');
          setError(cause instanceof Error ? cause.message : '分享视频预览失败');
        }
      }
    };

    void render();
  }, [adapter, draft, mediaTimeMs, resourceVersion, scoreEndBeat, status, template]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="w-full rounded-md border border-border bg-slate-950"
        aria-label="当前时间点画面预览"
      />
      {status === 'preparing' ? (
        <p className="text-xs text-muted-foreground">预览准备中...</p>
      ) : null}
      {status === 'ready' && !error ? (
        <p className="text-xs text-muted-foreground">预览已就绪，可在当前时间点检查版式。</p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
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
