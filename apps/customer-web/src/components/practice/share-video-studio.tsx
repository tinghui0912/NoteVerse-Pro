'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Columns2,
  Layers2,
  Loader2,
  RectangleHorizontal,
  RectangleVertical,
  SlidersHorizontal,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PerformanceReviewDraft } from '@/lib/practice/performance-review-draft';
import { ShareVideoPreview } from '@/lib/practice/share-video-preview';
import type { ShareVideoTemplate } from '@/lib/practice/share-video-templates';
import {
  exportSplitScreenPerformanceVideo,
  getSplitScreenExportReadiness,
  type SplitScreenExportBlockReason,
} from '@/lib/practice/split-screen-video-export';
import type { PracticeVerovioAdapter } from '@/lib/practice/verovio-adapter';

const FLOATING_SHARE_TEMPLATE_ENABLED = process.env.NODE_ENV !== 'production';

type VideoOrientation = 'landscape' | 'portrait';
type ScorePresentation = 'split' | 'floating';
type FloatingPosition = 'top' | 'bottom';
type FloatingSize = 'small' | 'medium' | 'large';

export function initialShareVideoOrientation(
  video: Pick<HTMLVideoElement, 'videoWidth' | 'videoHeight'> | null
): VideoOrientation {
  if (video && video.videoWidth > 0 && video.videoHeight > 0) {
    return video.videoWidth >= video.videoHeight ? 'landscape' : 'portrait';
  }
  return 'landscape';
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function extensionForMime(mimeType: string): string {
  const cleaned = mimeType.split(';')[0]?.trim().toLowerCase();
  return cleaned === 'video/mp4' ? 'mp4' : 'webm';
}

function splitScreenBlockReasonToMessage(
  t: (key: string) => string,
  reason: SplitScreenExportBlockReason
) {
  switch (reason) {
    case 'video_not_ready':
    case 'empty_video':
      return t('exportScoreVideoUnavailableVideo');
    case 'score_identity_mismatch':
      return t('exportScoreVideoUnavailableScoreMismatch');
    case 'score_not_ready':
      return t('exportScoreVideoUnavailableScore');
    case 'timebase_unavailable':
      return t('exportScoreVideoUnavailableSync');
    case 'media_recorder_unsupported':
    case 'canvas_capture_unsupported':
      return t('exportScoreVideoUnsupportedBrowser');
  }
}

function ShareChoiceCard({
  selected,
  title,
  description,
  icon: Icon,
  badge,
  onClick,
  testId,
}: {
  selected: boolean;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={testId}
      onClick={onClick}
      className={[
        'flex min-w-0 flex-1 items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-background hover:border-primary/50',
      ].join(' ')}
    >
      <span
        className={[
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
          selected
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border text-muted-foreground',
        ].join(' ')}
        aria-hidden="true"
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          {title}
          {badge ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

export function ShareVideoStudio({
  draft,
  scoreContainer,
  adapter,
  scoreEndBeat,
  isScoreIdentityConfirmed,
  xmlContent,
  mediaTimeMs,
  isReplayPlaying,
  replayVideo,
  open,
  onOpenChange,
  onExportingChange,
}: {
  draft: PerformanceReviewDraft;
  scoreContainer: HTMLElement | null;
  adapter: PracticeVerovioAdapter;
  scoreEndBeat: number;
  isScoreIdentityConfirmed: boolean;
  xmlContent: string | null;
  mediaTimeMs: number;
  isReplayPlaying: boolean;
  replayVideo: HTMLVideoElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExportingChange?: (exporting: boolean) => void;
}) {
  const t = useTranslations('practice');
  const [videoOrientation, setVideoOrientation] = useState<VideoOrientation>('landscape');
  const hasManuallySelectedOrientationRef = useRef(false);
  const [scorePresentation, setScorePresentation] = useState<ScorePresentation>('split');
  const [floatingPosition, setFloatingPosition] = useState<FloatingPosition>('top');
  const [floatingSize, setFloatingSize] = useState<FloatingSize>('medium');
  const [isFloatingAdvancedOpen, setIsFloatingAdvancedOpen] = useState(false);
  const [previewFrameTimeMs, setPreviewFrameTimeMs] = useState(mediaTimeMs);
  const [splitExportStatus, setSplitExportStatus] = useState<
    'idle' | 'exporting' | 'success' | 'error'
  >('idle');
  const [splitExportProgress, setSplitExportProgress] = useState(0);
  const [splitExportError, setSplitExportError] = useState<string | null>(null);
  const splitExportAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    hasManuallySelectedOrientationRef.current = false;

    const video = replayVideo;
    if (!video) return;

    const syncOrientationFromMetadata = () => {
      if (hasManuallySelectedOrientationRef.current) {
        return;
      }
      setVideoOrientation(initialShareVideoOrientation(video));
    };

    syncOrientationFromMetadata();
    video.addEventListener('loadedmetadata', syncOrientationFromMetadata);
    return () => video.removeEventListener('loadedmetadata', syncOrientationFromMetadata);
  }, [draft.localSessionId, replayVideo]);

  const shareTemplate = useMemo<ShareVideoTemplate>(() => {
    if (scorePresentation === 'floating') {
      return {
        kind: 'floating',
        orientation: videoOrientation,
        position: floatingPosition,
        size: floatingSize,
      };
    }
    return { kind: videoOrientation };
  }, [floatingPosition, floatingSize, scorePresentation, videoOrientation]);

  const shareTemplateSummary = useMemo(() => {
    const orientationLabel =
      videoOrientation === 'landscape'
        ? t('shareLandscapeTitle')
        : t('sharePortraitTitle');
    const presentationLabel =
      scorePresentation === 'floating' ? t('shareFloatingTitle') : t('shareSplitTitle');
    return scorePresentation === 'floating'
      ? t('shareTemplateSummary', {
          orientation: orientationLabel,
          presentation: presentationLabel,
          position: floatingPosition === 'top' ? t('shareTop') : t('shareBottom'),
        })
      : t('shareTemplateSummaryWithoutPosition', {
          orientation: orientationLabel,
          presentation: presentationLabel,
        });
  }, [floatingPosition, scorePresentation, t, videoOrientation]);

  const readiness = useMemo(
    () =>
      getSplitScreenExportReadiness({
        draft,
        isScoreIdentityConfirmed,
        xmlContent,
        scoreContainer,
      }),
    [draft, isScoreIdentityConfirmed, scoreContainer, xmlContent]
  );

  const handleExport = useCallback(async () => {
    if (
      !scoreContainer ||
      !readiness.ok ||
      splitExportStatus === 'exporting' ||
      draft.video?.status !== 'READY'
    ) {
      return;
    }

    const abortController = new AbortController();
    splitExportAbortRef.current = abortController;
    setSplitExportStatus('exporting');
    onExportingChange?.(true);
    setSplitExportProgress(0);
    setSplitExportError(null);

    try {
      const result = await exportSplitScreenPerformanceVideo({
        draft,
        scoreContainer,
        adapter,
        scoreEndBeat,
        signal: abortController.signal,
        onProgress: (progress) => setSplitExportProgress(progress.ratio),
        template: shareTemplate,
      });
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `performance-score-video-${Date.now()}.${extensionForMime(result.mimeType)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setSplitExportProgress(1);
      setSplitExportStatus('success');
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        setSplitExportStatus('idle');
        setSplitExportProgress(0);
        return;
      }
      setSplitExportStatus('error');
      setSplitExportError(cause instanceof Error ? cause.message : t('exportScoreVideoFailedDesc'));
    } finally {
      splitExportAbortRef.current = null;
      onExportingChange?.(false);
    }
  }, [
    adapter,
    draft,
    readiness.ok,
    scoreContainer,
    scoreEndBeat,
    shareTemplate,
    splitExportStatus,
    t,
    onExportingChange,
  ]);

  const handleCancelExport = useCallback(() => {
    splitExportAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    return () => {
      splitExportAbortRef.current?.abort();
      onExportingChange?.(false);
    };
  }, [onExportingChange]);

  if (!open) {
    return (
      <Card className="rounded-lg bg-card" data-testid="share-video-entry-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">{t('makeShareVideoTitle')}</CardTitle>
          <p className="text-xs text-muted-foreground">{t('makeShareVideoDesc')}</p>
        </CardHeader>
        <CardContent>
          <Button onClick={() => onOpenChange(true)} data-testid="open-share-video-studio">
            <Clapperboard className="mr-1.5 h-4 w-4" />
            {t('makeShareVideoAction')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-lg bg-card" data-testid="share-video-studio">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-sm font-semibold">{t('sharePerformanceVideoTitle')}</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">{t('sharePerformanceVideoDesc')}</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={splitExportStatus === 'exporting'}
          onClick={() => onOpenChange(false)}
          data-testid="collapse-share-video-studio"
        >
          {t('collapseShareVideoStudio')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{t('shareVideoOrientationStep')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('shareVideoOrientationDesc')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('shareVideoOrientationStep')}>
            <ShareChoiceCard
              selected={videoOrientation === 'landscape'}
              title={t('shareLandscapeTitle')}
              description={t('shareLandscapeDesc')}
              icon={RectangleHorizontal}
              onClick={() => {
                hasManuallySelectedOrientationRef.current = true;
                setVideoOrientation('landscape');
              }}
              testId="share-orientation-landscape"
            />
            <ShareChoiceCard
              selected={videoOrientation === 'portrait'}
              title={t('sharePortraitTitle')}
              description={t('sharePortraitDesc')}
              icon={RectangleVertical}
              onClick={() => {
                hasManuallySelectedOrientationRef.current = true;
                setVideoOrientation('portrait');
              }}
              testId="share-orientation-portrait"
            />
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{t('sharePresentationStep')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('sharePresentationDesc')}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('sharePresentationStep')}>
            <ShareChoiceCard
              selected={scorePresentation === 'split'}
              title={t('shareSplitTitle')}
              description={t('shareSplitDesc')}
              icon={Columns2}
              onClick={() => setScorePresentation('split')}
              testId="share-presentation-split"
            />
            {FLOATING_SHARE_TEMPLATE_ENABLED ? (
              <ShareChoiceCard
                selected={scorePresentation === 'floating'}
                title={t('shareFloatingTitle')}
                description={t('shareFloatingDesc')}
                icon={Layers2}
                badge={t('shareDevPreview')}
                onClick={() => setScorePresentation('floating')}
                testId="share-presentation-floating"
              />
            ) : null}
          </div>
        </section>

        {scorePresentation === 'floating' ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">{t('sharePositionStep')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('sharePositionDesc')}</p>
              </div>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                aria-expanded={isFloatingAdvancedOpen}
                onClick={() => setIsFloatingAdvancedOpen((value) => !value)}
                data-testid="share-floating-advanced-toggle"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                {t('shareAdjustPositionSize')}
                {isFloatingAdvancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('sharePositionStep')}>
              <ShareChoiceCard
                selected={floatingPosition === 'top'}
                title={t('shareTop')}
                description={t('shareTopDesc')}
                icon={RectangleHorizontal}
                onClick={() => setFloatingPosition('top')}
                testId="share-floating-position-top"
              />
              <ShareChoiceCard
                selected={floatingPosition === 'bottom'}
                title={t('shareBottom')}
                description={t('shareBottomDesc')}
                icon={RectangleHorizontal}
                onClick={() => setFloatingPosition('bottom')}
                testId="share-floating-position-bottom"
              />
            </div>
            {isFloatingAdvancedOpen ? (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold">
                  <SlidersHorizontal className="h-4 w-4" />
                  {t('shareScoreSize')}
                </div>
                <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('shareScoreSize')}>
                  {(['small', 'medium', 'large'] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={floatingSize === size}
                      onClick={() => setFloatingSize(size)}
                      className={[
                        'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        floatingSize === size
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background hover:border-primary/50',
                      ].join(' ')}
                      data-testid={`share-floating-size-${size}`}
                    >
                      {size === 'small' ? t('shareSmall') : size === 'medium' ? t('shareMedium') : t('shareLarge')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">{t('sharePreviewTitle')}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t('sharePreviewDesc')}</p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t('sharePreviewTime', { time: formatDuration(previewFrameTimeMs) })}
            </span>
          </div>
          <ShareVideoPreview
            draft={draft}
            scoreContainer={scoreContainer}
            adapter={adapter}
            scoreEndBeat={scoreEndBeat}
            mediaTimeMs={mediaTimeMs}
            template={shareTemplate}
            isReplayPlaying={isReplayPlaying}
            replayVideo={replayVideo}
            onFrameCommitted={setPreviewFrameTimeMs}
          />
        </section>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{t('shareExportTitle')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{shareTemplateSummary}</p>
          </div>
          {!readiness.ok ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {splitScreenBlockReasonToMessage(t, readiness.reason)}
            </p>
          ) : null}
          <Button
            onClick={handleExport}
            disabled={!readiness.ok || splitExportStatus === 'exporting'}
            aria-label={t('shareExportAction')}
            data-testid="generate-share-video"
          >
            {splitExportStatus === 'exporting' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Clapperboard className="mr-1.5 h-4 w-4" />
            )}
            {t('shareExportAction')}
          </Button>
        </section>

        {splitExportStatus === 'exporting' ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-100" data-testid="split-screen-export-progress">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold">{t('exportScoreVideoProgressTitle')}</h4>
                <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">
                  {t('exportScoreVideoProgressDesc', { progress: Math.round(splitExportProgress * 100) })}
                </p>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round(splitExportProgress * 100)}%` }} />
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={handleCancelExport}>
                {t('cancelExportScoreVideo')}
              </Button>
            </div>
          </div>
        ) : null}
        {splitExportStatus === 'error' ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-100" data-testid="split-screen-export-error">
            <h4 className="text-sm font-semibold">{t('exportScoreVideoFailedTitle')}</h4>
            <p className="mt-1 text-xs">{splitExportError ?? t('exportScoreVideoFailedDesc')}</p>
          </div>
        ) : null}
        {splitExportStatus === 'success' ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100" data-testid="split-screen-export-success">
            <p className="text-sm font-semibold">{t('exportScoreVideoSuccessTitle')}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
