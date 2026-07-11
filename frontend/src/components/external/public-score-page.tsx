'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResourceLoading } from '@/components/loading';
import { ScoreCapabilityProvider } from '@/components/score/score-capability-context';
import { ScoreSurface } from '@/components/score/score-surface';
import { ExternalScoreActions } from '@/components/score-detail/external-score-actions';
import { ScoreDetailHero } from '@/components/score-detail/score-detail-hero';
import { ScoreDetailTabs } from '@/components/score-detail/score-detail-tabs';
import { ScoreInfoPanel } from '@/components/score-detail/score-info-panel';
import { ResourceLoadError } from '@/components/states';
import { useAuth } from '@/contexts/auth-context';
import { usePublicScore } from '@/hooks/queries/use-score-queries';
import { filesApi, publicationsApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { formatApiDateTime } from '@/lib/date-time';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { resolveScoreCapabilities } from '@/lib/score/capabilities';
import { publicDerivedThumbnailUrl } from '@/lib/score-detail/thumbnail';

function PublicScoreContent({ slug }: { slug: string }) {
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const scoreText = useTranslations('score');
  const { isAuthenticated } = useAuth();
  const publication = usePublicScore(slug);
  const data = publication.data?.data;

  if (publication.isLoading) {
    return (
      <ScoreSurface>
        <ResourceLoading label={common('loadingPublicScore')} minHeight="screen" />
      </ScoreSurface>
    );
  }

  if (!data || publication.error) {
    const description = publication.error instanceof ApiError
      ? translateErrorCode(errors, publication.error.code, common('loadFailed'))
      : common('loadFailed');
    return (
      <ScoreSurface>
        <ResourceLoadError
          title={common('loadFailed')}
          description={description}
          actionLabel={common('nav.home')}
          actionHref="/"
          className="min-h-[calc(100vh-4rem)]"
        />
      </ScoreSurface>
    );
  }

  const capabilities = resolveScoreCapabilities(data.capabilities);
  const pageCount = data.artifacts.filter((artifact) => artifact.kind === 'RENDERED_PAGE').length;
  const scoreId = data.publication.score_id;
  const download = async (kind: 'MUSICXML' | 'RENDERED_PAGE') => {
    const artifacts = data.artifacts.filter((artifact) => artifact.kind === kind);
    for (const artifact of artifacts) {
      const blob = await publicationsApi.downloadArtifact(slug, artifact.artifact_id);
      filesApi.triggerDownload(blob, artifact.filename);
    }
  };

  return (
    <ScoreCapabilityProvider capabilities={capabilities} scoreId={scoreId} workspace="public">
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <ScoreDetailHero
            title={data.title}
            subtitle={scoreText('publicScore')}
            thumbnailUrl={publicDerivedThumbnailUrl(
              slug,
              data.derived_assets.preview.artifact_id
            )}
            playbackEnabled={capabilities.can_practice}
            playbackAudioSrc={publicationsApi.playbackUrl(slug)}
            actions={(
              <ExternalScoreActions
                openAppHref={isAuthenticated ? `/score/${scoreId}` : undefined}
                onDownloadImage={() => void download('RENDERED_PAGE')}
                onDownloadXml={() => void download('MUSICXML')}
              />
            )}
            meta={(
              <span>{scoreText('publishedAt')} {formatApiDateTime(data.publication.published_at)}</span>
            )}
          />
          <ScoreDetailTabs
            tabs={[
              {
                value: 'info',
                label: scoreText('scoreInfo'),
                content: (
                  <ScoreInfoPanel
                    imageCount={pageCount}
                    metadata={data.metadata}
                    taxonomyTags={data.taxonomy_tags}
                    title={data.title}
                  />
                ),
              },
              {
                value: 'public',
                label: scoreText('publicInfo'),
                content: (
                  <Card className="rounded-2xl bg-white shadow-sm">
                    <CardHeader>
                      <CardTitle>{scoreText('publicInfo')}</CardTitle>
                    </CardHeader>
                    <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
                      <div>
                        <p className="text-muted-foreground">{scoreText('publishedAt')}</p>
                        <time className="font-medium" dateTime={data.publication.published_at}>
                          {formatApiDateTime(data.publication.published_at)}
                        </time>
                      </div>
                      <div>
                        <p className="text-muted-foreground">{common('download')}</p>
                        <p className="font-medium">
                          {data.publication.allow_download ? scoreText('allowed') : scoreText('notAllowed')}
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                ),
              },
            ]}
          />
        </div>
      </ScoreSurface>
    </ScoreCapabilityProvider>
  );
}

export function PublicScorePage({ slug }: { slug: string }) {
  return <PublicScoreContent slug={slug} />;
}
