'use client';

import { useEffect, useRef, useState } from 'react';

import type { PerformanceReviewDraft } from './performance-review-draft';
import { renderSplitScreenFrameAtTime } from './split-screen-frame-renderer';
import {
  findStablePageNumber,
  prepareScorePageCache,
} from './split-screen-score-model';
import { resolveSplitScreenScoreFrame } from './split-screen-playback-position';
import { getShareVideoLayout, type ShareVideoTemplate } from './share-video-templates';
import type { PracticeVerovioAdapter } from './verovio-adapter';

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas || !scoreContainer || draft.video?.status !== 'READY') {
      return;
    }
    const videoDraft = draft.video;

    const render = async () => {
      const layout = getShareVideoLayout(template);
      canvas.width = layout.width;
      canvas.height = layout.height;
      const video = document.createElement('video');
      const url = URL.createObjectURL(videoDraft.blob);
      try {
        video.src = url;
        video.preload = 'auto';
        video.playsInline = true;
        await waitForPreviewVideo(video);
        if (cancelled) return;
        const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : videoDraft.durationMs;
        await seekPreviewVideo(
          video,
          Math.min(Math.max(0, mediaTimeMs), Math.max(0, durationMs - 1))
        );
        if (cancelled) return;
        const scorePages = await prepareScorePageCache(scoreContainer);
        if (cancelled) return;
        await renderSplitScreenFrameAtTime({
          mediaTimeMs: video.currentTime * 1000,
          scoreModel: scorePages,
          playbackTimeline: {
            resolve: (timeMs) => resolveSplitScreenScoreFrame({
              draft,
              adapter,
              pageNumberResolver: (noteIds) => findStablePageNumber(noteIds, scorePages),
              mediaTimeMs: timeMs,
              actualMediaDurationMs: durationMs,
              scoreEndBeat,
            }),
          },
          sourceVideoFrame: video,
          outputCanvas: canvas,
          layout,
        });
        if (!cancelled) setError(null);
      } catch (cause) {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Preview unavailable');
        }
      } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [adapter, draft, mediaTimeMs, scoreContainer, scoreEndBeat, template]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        className="w-full rounded-md border border-border bg-slate-950"
        aria-label="分享视频实时预览"
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
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
