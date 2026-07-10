'use client';

import { Download, ExternalLink, Gamepad2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResourceLoadError } from '@/components/error/resource-load-error';
import { ScoreCapabilityProvider } from '@/components/score/score-capability-context';
import { ScoreSurface } from '@/components/score/score-surface';
import { ScorePlayer } from '@/components/score-detail/score-player';
import { useAuth } from '@/contexts/auth-context';
import { EditorProvider } from '@/contexts/editor-provider';
import { usePublicScore, usePublicScoreContent } from '@/hooks/queries/use-score-queries';
import { ApiError } from '@/lib/api-client';
import { filesApi, publicationsApi } from '@/lib/api';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { formatKeySignature } from '@/lib/score/metadata-display';
import { resolveScoreCapabilities } from '@/lib/score/capabilities';

function PublicScoreContent({ slug }: { slug: string }) {
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const practice = useTranslations('practice');
  const scoreText = useTranslations('score');
  const { isAuthenticated } = useAuth();
  const publication = usePublicScore(slug);
  const content = usePublicScoreContent(slug);
  const data = publication.data?.data;
  const rawXml = content.data?.data?.content ?? '';

  if (publication.isLoading || content.isLoading) {
    return (
      <ScoreSurface>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScoreSurface>
    );
  }

  const loadError = publication.error ?? content.error;
  if (!data || loadError) {
    const description = loadError instanceof ApiError
      ? translateErrorCode(errors, loadError.code, common('loadFailed'))
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
          <div className="mb-8">
            <p className="text-sm font-medium text-orange-600">{scoreText('publicScore')}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
              {data.title}
            </h1>
          </div>
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ScorePlayer rawXml={rawXml} />
            </div>

            <aside className="sticky top-24 space-y-6 lg:col-span-1">
              <Card className="rounded-2xl bg-white shadow-lg">
                <CardHeader>
                  <CardTitle>{scoreText('scoreInfo')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <span className="shrink-0 text-muted-foreground">{scoreText('scoreName')}</span>
                    <span className="truncate text-right font-medium">{data.title}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{scoreText('keySignature')}</span>
                    <span className="font-medium">
                      {formatKeySignature(
                        data.metadata?.primary_key_fifths,
                        data.metadata?.primary_mode
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{scoreText('measureCount')}</span>
                    <span className="font-medium">{data.metadata?.measure_count ?? '-'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground">{scoreText('totalPages')}</span>
                    <span className="font-medium">{scoreText('pageCount', { count: pageCount })}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl bg-white shadow-lg">
                <CardHeader>
                  <CardTitle>{scoreText('actionsTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3">
                  {isAuthenticated ? (
                    <Button asChild variant="outline" className="h-16 justify-start gap-3 bg-white px-4">
                      <Link href={`/score/${scoreId}`}>
                        <ExternalLink className="h-5 w-5 shrink-0" />
                        <span className="truncate">{common('openApp')}</span>
                      </Link>
                    </Button>
                  ) : null}

                  {capabilities.can_practice ? (
                    <Button asChild variant="outline" className="h-16 justify-start gap-3 bg-white px-4">
                      <Link href={`/score/${scoreId}/practice?publicSlug=${slug}`}>
                        <Gamepad2 className="h-5 w-5 shrink-0" />
                        <span className="truncate">{practice('mode')}</span>
                      </Link>
                    </Button>
                  ) : null}

                  {capabilities.can_download ? (
                    <>
                      <Button
                        variant="outline"
                        className="h-16 justify-start gap-3 bg-white px-4"
                        onClick={() => void download('MUSICXML')}
                      >
                        <Download className="h-5 w-5 shrink-0" />
                        <span className="truncate">{scoreText('downloadMusicXML')}</span>
                      </Button>
                      <Button
                        variant="outline"
                        className="h-16 justify-start gap-3 bg-white px-4"
                        onClick={() => void download('RENDERED_PAGE')}
                      >
                        <Download className="h-5 w-5 shrink-0" />
                        <span className="truncate">{scoreText('downloadImage')}</span>
                      </Button>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            </aside>
          </div>
        </div>
      </ScoreSurface>
    </ScoreCapabilityProvider>
  );
}

export function PublicScorePage({ slug }: { slug: string }) {
  return (
    <EditorProvider>
      <PublicScoreContent slug={slug} />
    </EditorProvider>
  );
}
