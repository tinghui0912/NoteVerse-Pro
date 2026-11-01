'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';

import { PageHeader } from '@/components/page';
import { PerformanceReplayPlayer } from '@/components/practice/performance-replay-player';
import { ShareVideoStudio } from '@/components/practice/share-video-studio';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  usePerformanceTakeDetail,
} from '@/hooks/queries/use-performance-take-queries';
import {
  downloadPerformanceTakeMediaBlob,
} from '@/lib/api/performance-takes';
import { ApiError } from '@/lib/api-client';
import { usePerformanceTakePracticeSource } from '@/hooks/practice/use-practice-revision-source';
import type { PlayablePerformanceReplay } from '@/lib/practice/recording/performance-replay';
import {
  createShareVideoSessionFromSavedTake,
  hasSavedTakeShareVideoMetadata,
} from '@/lib/practice/sharing/video/saved-take-adapter';
import { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';

function takeIdFromParams(params: ReturnType<typeof useParams>): string {
  const value = params?.takeId;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function isPermanentResourceError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

function HistoricalTakeUnavailable({
  message,
  backLabel,
  onBack,
  retryLabel,
  onRetry,
}: {
  message: string;
  backLabel: string;
  onBack: () => void;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          <AlertCircle className="h-8 w-8 text-amber-600" />
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {onRetry && retryLabel ? (
              <Button onClick={onRetry}>{retryLabel}</Button>
            ) : null}
            <Button variant="outline" onClick={onBack}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {backLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function HistoricalPerformanceSharePage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('practice');
  const takeId = takeIdFromParams(params);
  const takeQuery = usePerformanceTakeDetail(takeId);
  const take = takeQuery.data?.data ?? null;
  const isBaseEligible = Boolean(take && hasSavedTakeShareVideoMetadata(take));

  const source = usePerformanceTakePracticeSource(takeId, {
    sourceId: take?.source_id ?? '', scoreId: take?.source_score_id ?? '', revisionId: take?.source_revision_id ?? '',
    artifactId: take?.source_artifact_id ?? '',
  }, { loadNotation: true, enabled: isBaseEligible });
  const sourceQuery = source.sourceQuery;
  const artifact = source.artifact;

  const [mediaBlob, setMediaBlob] = useState<Blob | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaErrorPermanent, setMediaErrorPermanent] = useState(false);
  const [mediaProgress, setMediaProgress] = useState<{
    loadedBytes: number;
    totalBytes: number | null;
  }>({ loadedBytes: 0, totalBytes: null });
  const [mediaRetryNonce, setMediaRetryNonce] = useState(0);
  const [replayVideo, setReplayVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaTimeMs, setMediaTimeMs] = useState(0);
  const [scoreContainer, setScoreContainer] = useState<HTMLDivElement | null>(null);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const adapter = useMemo(() => new PracticeVerovioAdapter(), []);
  const adapterFactory = useCallback(() => adapter, [adapter]);

  useEffect(() => {
    if (!take || !isBaseEligible) {
      return;
    }
    const controller = new AbortController();
    void downloadPerformanceTakeMediaBlob(take.take_id, {
      signal: controller.signal,
      onProgress: (loadedBytes, totalBytes) => {
        if (!controller.signal.aborted) {
          setMediaProgress({ loadedBytes, totalBytes });
        }
      },
    })
      .then((blob) => {
        if (!controller.signal.aborted) setMediaBlob(blob);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setMediaErrorPermanent(isPermanentResourceError(error));
          setMediaError(
            t('historicalShareMediaUnavailable')
          );
        }
      });
    return () => controller.abort();
  }, [isBaseEligible, mediaRetryNonce, t, take]);

  useEffect(() => () => adapter.dispose(), [adapter]);

  const isSourceReady = Boolean(source.artifact && source.musicXml);
  const sessionEligibility = useMemo(() => {
    if (!take || !mediaBlob || !artifact || !isSourceReady) return null;
    return createShareVideoSessionFromSavedTake(
      take,
      mediaBlob,
      { sourceId: source.sourceId!, artifact }
    );
  }, [artifact, isSourceReady, mediaBlob, take, source.sourceId]);
  const session =
    sessionEligibility?.status === 'supported'
      ? sessionEligibility.session
      : null;

  const replay = useMemo<PlayablePerformanceReplay | null>(() => {
    if (!session) return null;
    return {
      kind: 'VIDEO_RECORDING',
      blob: session.video.blob,
      contentType: session.video.mimeType,
      byteSize: session.video.blob.size,
      durationMs: session.video.durationMs,
    };
  }, [session]);

  const xmlContent = source.musicXml;
  if (takeQuery.isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (takeQuery.isError || !take) {
    return (
      <HistoricalTakeUnavailable
        message={
          isPermanentResourceError(takeQuery.error)
            ? t('historicalShareUnavailable')
            : t('historicalShareTemporaryUnavailable')
        }
        backLabel={t('historicalShareBack')}
        retryLabel={
          isPermanentResourceError(takeQuery.error)
            ? undefined
            : t('historicalShareRetry')
        }
        onRetry={
          isPermanentResourceError(takeQuery.error)
            ? undefined
            : () => void takeQuery.refetch()
        }
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (!hasSavedTakeShareVideoMetadata(take)) {
    return (
      <HistoricalTakeUnavailable
        message={t('historicalShareUnavailable')}
        backLabel={t('historicalShareBack')}
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (mediaError) {
    return (
      <HistoricalTakeUnavailable
        message={
          mediaErrorPermanent
            ? t('historicalShareUnavailable')
            : t('historicalShareTemporaryUnavailable')
        }
        backLabel={t('historicalShareBack')}
        retryLabel={mediaErrorPermanent ? undefined : t('historicalShareRetry')}
        onRetry={
          mediaErrorPermanent
            ? undefined
            : () => {
                setMediaBlob(null);
                setMediaError(null);
                setMediaErrorPermanent(false);
                setMediaProgress({ loadedBytes: 0, totalBytes: null });
                setMediaRetryNonce((value) => value + 1);
              }
        }
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (
    source.invalid
  ) {
    return (
      <HistoricalTakeUnavailable
        message={t('historicalShareRevisionUnavailable')}
        backLabel={t('historicalShareBack')}
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (
    isPermanentResourceError(source.transportError)
  ) {
    return (
      <HistoricalTakeUnavailable
        message={t('historicalShareRevisionUnavailable')}
        backLabel={t('historicalShareBack')}
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (sessionEligibility?.status === 'unsupported') {
    return (
      <HistoricalTakeUnavailable
        message={t('historicalShareRevisionUnavailable')}
        backLabel={t('historicalShareBack')}
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (source.isError) {
    return (
      <HistoricalTakeUnavailable
        message={t('historicalShareTemporaryUnavailable')}
        backLabel={t('historicalShareBack')}
        retryLabel={t('historicalShareRetry')}
        onRetry={() => {
          void sourceQuery.refetch();
        }}
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (!session || !replay || !isSourceReady || !xmlContent || !artifact) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <PageHeader title={t('historicalShareTitle')} />
        <Card>
          <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
            {mediaProgress.totalBytes ? (
              <p>
                {t('historicalShareLoadingMedia', {
                  progress: ` ${Math.round(
                    (mediaProgress.loadedBytes / mediaProgress.totalBytes) * 100
                  )}%`,
                })}
              </p>
            ) : (
              <p>{t('historicalShareLoadingMedia', { progress: '' })}</p>
            )}
            {mediaProgress.totalBytes ? (
              <progress
                className="h-2 w-full max-w-sm"
                value={Math.min(mediaProgress.loadedBytes, mediaProgress.totalBytes)}
                max={mediaProgress.totalBytes}
                aria-label={t('historicalShareLoadingMedia', {
                  progress: `${Math.round(
                    (mediaProgress.loadedBytes / mediaProgress.totalBytes) * 100
                  )}%`,
                })}
              />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
            {!mediaBlob ? null : <p>{t('historicalSharePreparing')}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('historicalShareTitle')}
        description={take.score_title_snapshot}
        actions={
          <Button variant="outline" onClick={() => router.push('/my-performances')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('historicalShareBack')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('historicalShareRecording')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceReplayPlayer
              replay={replay}
              onReplayTimeChange={(time) => setMediaTimeMs(Math.max(0, time ?? 0))}
              onPlaybackStateChange={setIsReplayPlaying}
              onVideoElementChange={setReplayVideo}
            />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">{t('historicalShareScore')}</CardTitle>
          </CardHeader>
          <CardContent>
            <VerovioScoreViewer
              xmlContent={xmlContent}
              adapterFactory={adapterFactory}
              onRendered={(_renderedAdapter, container) => setScoreContainer(container)}
              className="max-h-[32rem] overflow-auto rounded-md border bg-white"
              pagesClassName="gap-4 p-4"
              pageClassName="w-full overflow-hidden bg-white"
              svgClassName="w-full"
              loadingContent={<div className="p-8 text-sm text-muted-foreground">{t('historicalShareLoading')}</div>}
              emptyContent={<div className="p-8 text-sm text-muted-foreground">{t('historicalShareEmptyScore')}</div>}
              renderError={(message) => <div className="p-8 text-sm text-destructive">{message}</div>}
            />
          </CardContent>
        </Card>
      </div>

      <ShareVideoStudio
        session={session}
        scoreContainer={scoreContainer}
        adapter={adapter}
        scoreEndBeat={artifact.scoreEndBeat}
        isScoreIdentityConfirmed={isSourceReady}
        xmlContent={xmlContent}
        mediaTimeMs={mediaTimeMs}
        isReplayPlaying={isReplayPlaying}
        replayVideo={replayVideo}
        open
        collapsible={false}
        onOpenChange={() => undefined}
      />
    </div>
  );
}
