'use client';

import { captureMediaExtension } from '@/lib/practice/recording/media-policy';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, AlertCircle, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';

import { PageHeader } from '@/components/page';
import { PerformanceReplayPlayer } from '@/components/practice/performance-replay-player';
import { VideoExportStudio } from '@/components/practice/video-export-studio';
import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  usePerformanceTakeDetail,
} from '@/hooks/queries/use-performance-take-queries';
import {
  materializePerformanceTakeMedia,
} from '@/lib/practice/media/performance-take/materialize';
import { releaseLocalMediaAsset, type LocalMediaAsset } from '@/lib/practice/media/local-media-asset';
import { downloadLocalMedia } from '@/lib/practice/media/download-local-media';
import { ApiError } from '@/lib/api-client';
import { useSavedTakeExportSource } from '@/hooks/practice/use-saved-take-export-source';
import type { PlayablePerformanceReplay } from '@/lib/practice/recording/performance-replay';
import {
  createVideoExportSessionFromSavedTake,
  hasSavedTakeVideoExportMetadata,
} from '@/lib/practice/video-export/saved-take-adapter';
import { PracticeVerovioAdapter } from '@/lib/practice/score-view/verovio-adapter';

function takeIdFromParams(params: ReturnType<typeof useParams>): string {
  const value = params?.takeId;
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function isPermanentResourceError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

function SavedTakeExportUnavailable({
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

export default function SavedPerformanceVideoExportPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('practice');
  const takeId = takeIdFromParams(params);
  const takeQuery = usePerformanceTakeDetail(takeId);
  const take = takeQuery.data?.data ?? null;
  const isBaseEligible = Boolean(take && hasSavedTakeVideoExportMetadata(take));

  const source = useSavedTakeExportSource({
    sourceId: take?.source_id ?? '', scoreId: take?.source_score_id ?? '', revisionId: take?.source_revision_id ?? '',
    artifactId: take?.source_artifact_id ?? '',
  }, { enabled: isBaseEligible });
  const sourceQuery = source.sourceQuery;
  const artifact = source.artifact;

  const [downloadedMedia, setDownloadedMedia] = useState<{take: typeof take; nonce: number; handle: LocalMediaAsset} | null>(null);
  const [mediaFailure, setMediaFailure] = useState<{take: typeof take; nonce: number; permanent: boolean} | null>(null);
  const [mediaProgress, setMediaProgress] = useState<{
    loadedBytes: number;
    totalBytes: number | null;
  }>({ loadedBytes: 0, totalBytes: null });
  const [mediaRetryNonce, setMediaRetryNonce] = useState(0);
  const mediaHandle = downloadedMedia?.take === take && downloadedMedia.nonce === mediaRetryNonce ? downloadedMedia.handle : null;
  const mediaError = mediaFailure?.take === take && mediaFailure.nonce === mediaRetryNonce;
  const mediaErrorPermanent = mediaError && mediaFailure.permanent;
  const [replayVideo, setReplayVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaTimeMs, setMediaTimeMs] = useState(0);
  const [scoreContainer, setScoreContainer] = useState<HTMLDivElement | null>(null);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const adapter = useMemo(() => new PracticeVerovioAdapter(artifact), [artifact]);
  const adapterFactory = useCallback(() => adapter, [adapter]);

  useEffect(() => {
    if (!take || !isBaseEligible) {
      return;
    }
    const controller = new AbortController();
    let owned: LocalMediaAsset | null = null;
    void materializePerformanceTakeMedia({ takeId: take.take_id, expectedByteSize: take.media_byte_size, expectedMimeType: take.media_mime_type,
      signal: controller.signal,
      onProgress: (loadedBytes, totalBytes) => {
        if (!controller.signal.aborted) {
          setMediaProgress({ loadedBytes, totalBytes });
        }
      },
    })
      .then(async (handle) => {
        if (controller.signal.aborted) { await releaseLocalMediaAsset(handle); return; }
        owned = handle;
        setDownloadedMedia({take, nonce: mediaRetryNonce, handle});
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setMediaFailure({take,nonce:mediaRetryNonce,permanent:isPermanentResourceError(error)});
        }
      });
    return () => { controller.abort(); if (owned) void releaseLocalMediaAsset(owned); };
  }, [isBaseEligible, mediaRetryNonce, take]);

  useEffect(() => () => adapter.dispose(), [adapter]);

  const isSourceReady = Boolean(source.artifact && source.musicXml);
  const sessionEligibility = useMemo(() => {
    if (!take || !mediaHandle || !artifact || !isSourceReady) return null;
    return createVideoExportSessionFromSavedTake(
      take,
      mediaHandle,
      { sourceId: source.sourceId!, artifact }
    );
  }, [artifact, isSourceReady, mediaHandle, take, source.sourceId]);
  const session =
    sessionEligibility?.status === 'supported'
      ? sessionEligibility.session
      : null;

  const replay = useMemo<PlayablePerformanceReplay | null>(() => {
    if (!take || !mediaHandle) return null;
    return {
      kind: 'VIDEO_RECORDING',
      media: mediaHandle,
      contentType: take.media_mime_type,
      byteSize: mediaHandle.byteSize,
      durationMs: take.duration_ms,
    };
  }, [take, mediaHandle]);

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
      <SavedTakeExportUnavailable
        message={
          isPermanentResourceError(takeQuery.error)
            ? t('savedTakeVideoExportUnavailable')
            : t('savedTakeVideoExportTemporaryUnavailable')
        }
        backLabel={t('savedTakeVideoExportBack')}
        retryLabel={
          isPermanentResourceError(takeQuery.error)
            ? undefined
            : t('savedTakeVideoExportRetry')
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
  if (!hasSavedTakeVideoExportMetadata(take)) {
    return (
      <SavedTakeExportUnavailable
        message={t('savedTakeVideoExportUnavailable')}
        backLabel={t('savedTakeVideoExportBack')}
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  if (mediaError) {
    return (
      <SavedTakeExportUnavailable
        message={
          mediaErrorPermanent
            ? t('savedTakeVideoExportUnavailable')
            : t('savedTakeVideoExportTemporaryUnavailable')
        }
        backLabel={t('savedTakeVideoExportBack')}
        retryLabel={mediaErrorPermanent ? undefined : t('savedTakeVideoExportRetry')}
        onRetry={
          mediaErrorPermanent
            ? undefined
            : () => {
                setDownloadedMedia(null);
                setMediaFailure(null);
                setMediaProgress({ loadedBytes: 0, totalBytes: null });
                setMediaRetryNonce((value) => value + 1);
              }
        }
        onBack={() => router.push('/my-performances')}
      />
    );
  }
  const exportUnavailable = source.invalid || isPermanentResourceError(source.transportError)
    || sessionEligibility?.status === 'unsupported';
  if (!replay) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <PageHeader title={t('savedTakeVideoExportTitle')} />
        <Card>
          <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 p-8 text-sm text-muted-foreground">
            {mediaProgress.totalBytes ? (
              <p>
                {t('savedTakeVideoExportLoadingMedia', {
                  progress: ` ${Math.round(
                    (mediaProgress.loadedBytes / mediaProgress.totalBytes) * 100
                  )}%`,
                })}
              </p>
            ) : (
              <p>{t('savedTakeVideoExportLoadingMedia', { progress: '' })}</p>
            )}
            {mediaProgress.totalBytes ? (
              <progress
                className="h-2 w-full max-w-sm"
                value={Math.min(mediaProgress.loadedBytes, mediaProgress.totalBytes)}
                max={mediaProgress.totalBytes}
                aria-label={t('savedTakeVideoExportLoadingMedia', {
                  progress: `${Math.round(
                    (mediaProgress.loadedBytes / mediaProgress.totalBytes) * 100
                  )}%`,
                })}
              />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
            {!mediaHandle ? null : <p>{t('savedTakeVideoExportPreparing')}</p>}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('savedTakeVideoExportTitle')}
        description={take.score_title_snapshot}
        actions={
          <Button variant="outline" onClick={() => router.push('/my-performances')}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('savedTakeVideoExportBack')}
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('savedTakeVideoExportRecording')}</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceReplayPlayer
              replay={replay}
              actions={<Button onClick={() => {
                void downloadLocalMedia(mediaHandle!, `performance-${take.take_id}.${captureMediaExtension(take.media_mime_type)}`);
              }}>{t('downloadVideo')}</Button>}
              onReplayTimeChange={(time) => setMediaTimeMs(Math.max(0, time ?? 0))}
              onPlaybackStateChange={setIsReplayPlaying}
              onVideoElementChange={setReplayVideo}
            />
          </CardContent>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="text-sm">{t('savedTakeVideoExportScore')}</CardTitle>
          </CardHeader>
          <CardContent>
            {exportUnavailable || source.isError ? <div className="space-y-3 p-8" role="status">
              <p>{t(exportUnavailable ? 'savedTakeVideoExportRevisionUnavailable' : 'savedTakeVideoExportTemporaryUnavailable')}</p>
              {!exportUnavailable && <Button onClick={() => { void sourceQuery.refetch(); }}>{t('savedTakeVideoExportRetry')}</Button>}
            </div> : <VerovioScoreViewer
              isLoading={source.isLoading}
              xmlContent={xmlContent}
              adapterFactory={adapterFactory}
              onRendered={(_renderedAdapter, container) => setScoreContainer(container)}
              className="max-h-[32rem] overflow-auto rounded-md border bg-white"
              pagesClassName="gap-4 p-4"
              pageClassName="w-full overflow-hidden bg-white"
              svgClassName="w-full"
              loadingContent={<div className="p-8 text-sm text-muted-foreground">{t('savedTakeVideoExportLoading')}</div>}
              emptyContent={<div className="p-8 text-sm text-muted-foreground">{t('savedTakeVideoExportEmptyScore')}</div>}
              renderError={(message) => <div className="p-8 text-sm text-destructive">{message}</div>}
            />}
          </CardContent>
        </Card>
      </div>

      {session && artifact && xmlContent && <VideoExportStudio
        session={session}
        scoreContainer={scoreContainer}
        adapter={adapter}
        scoreEndTick={artifact.scoreEndTick} ticksPerQuarter={artifact.ticksPerQuarter}
        isScoreIdentityConfirmed={isSourceReady}
        xmlContent={xmlContent}
        mediaTimeMs={mediaTimeMs}
        isReplayPlaying={isReplayPlaying}
        replayVideo={replayVideo}
        open
        collapsible={false}
        onOpenChange={() => undefined}
      />}
    </div>
  );
}
