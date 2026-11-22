'use client';

import React, { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ResourceLoading } from '@/components/loading';
import { PageHeader } from '@/components/page';
import { ScoreCapabilityProvider } from '@/features/scores/core/components/score-capability-context';
import { ScoreDeleteDialog } from '@/features/scores/core/components/score-delete-dialog';
import { ScoreLeaveDialog } from '@/features/scores/collaboration/leave-dialog';
import { useDeleteScores } from '@/features/scores/core/queries';
import { useLeaveScore } from '@/features/scores/collaboration/queries';
import { Button } from '@/components/ui/button';
import { ScoreSurface } from '@/features/scores/core/components/score-surface';
import { ScoreBreadcrumbs } from '@/features/scores/core/detail/score-breadcrumbs';
import { ScoreCollaborationPanel } from '@/features/scores/collaboration/owner-panel';
import { ScoreDetailHero } from '@/features/scores/core/detail/score-detail-hero';
import { ScoreDetailTabs } from '@/features/scores/core/detail/score-detail-tabs';
import { ScoreHeroActions } from '@/features/scores/core/detail/score-hero-actions';
import { ScoreInfoPanel } from '@/features/scores/core/detail/score-info-panel';
import { ScoreGuestPreviewPanel } from '@/features/scores/guest-preview/owner-panel';
import { ScoreVersionsPanel } from '@/features/scores/core/detail/score-versions-panel';
import { ResourceLoadError } from '@/components/states';
import { useScoreDetailSummary } from '@/features/scores/core/detail/use-score-detail-summary';
import { scoresApi } from '@/features/scores/core/api';
import { formatApiDateTime } from '@/lib/date-time';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import {
  isDerivedAssetPreparing,
  playableAudioRevisionId,
} from '@/features/scores/core/detail/derived-assets';
import { scoreThumbnailUrl } from '@/features/scores/core/detail/thumbnail';

function ScorePageContent({ id }: { id: string }) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resources = useScoreDetailSummary(id);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const deleteScores = useDeleteScores();
  const leaveScore = useLeaveScore();
  const [leaveOpen, setLeaveOpen] = React.useState(false);
  const error = resources.scoreError
    ? userFacingErrorMessage(
        errors,
        resources.scoreError,
        common('loadFailedDescription'),
      )
    : null;
  const scoreDisplayTitle =
    resources.score?.display_title || t('scoreFallbackTitle', { id: id.slice(0, 8) });
  const capabilities = resources.score?.capabilities ?? null;

  if (resources.scoreLoading) {
    return (
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader title={t('title')} />
          <ResourceLoading label={common('loadingScore')} minHeight="md" />
        </div>
      </ScoreSurface>
    );
  }

  if (error || !resources.score) {
    return (
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader title={t('title')} />
          <ResourceLoadError
            title={common('loadFailed')}
            description={error ?? common('loadFailedDescription')}
            actionLabel={t('backToLibrary')}
            actionHref="/library"
            className="min-h-[40vh]"
          />
        </div>
      </ScoreSurface>
    );
  }

  const score = resources.score;
  const previewAsset = score.derived_assets.preview;
  const audioAsset = score.derived_assets.audio;
  const audioRevisionId = playableAudioRevisionId(
    score.derived_assets,
    score.capabilities.can_practice,
    score.head_revision_id,
  );
  const audioPreparing = isDerivedAssetPreparing(audioAsset.status);
  const imagePreparing = isDerivedAssetPreparing(previewAsset.status);
  const playbackAudioSrc = audioRevisionId
    ? scoresApi.playbackUrl(score.score_id, audioRevisionId)
    : undefined;
  const tabs = [
    {
      value: 'info',
      label: t('scoreInfo'),
      content: (
        <ScoreInfoPanel
          canEditDisplayTitle={score.capabilities.can_edit}
          createdAt={score.created_at}
          imageCount={resources.imageCount}
          imageCountStatus={previewAsset.status}
          metadata={score.metadata}
          scoreId={score.score_id}
          genres={score.genres}
          displayTitle={scoreDisplayTitle}
          updatedAt={score.updated_at}
          metadataVersion={score.metadata_version}
        />
      ),
    },
    score.capabilities.can_edit
      ? {
          value: 'versions',
          label: t('versionsAction'),
          content: (
            <ScoreVersionsPanel
              canRestore={score.capabilities.can_edit}
              headRevisionId={score.head_revision_id}
              scoreId={score.score_id}
            />
          ),
        }
      : null,
    score.capabilities.can_manage_guest_previews
      ? {
          value: 'guest-preview',
          label: t('guestPreviewAction'),
          content: (
            <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
              <ScoreGuestPreviewPanel scoreId={score.score_id} />
            </div>
          ),
        }
      : null,
    score.capabilities.can_manage_members
      ? {
          value: 'collaboration',
          label: t('collaborationAction'),
          content: (
            <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
              <ScoreCollaborationPanel
                scoreId={score.score_id}
                scoreDisplayTitle={scoreDisplayTitle}
              />
            </div>
          ),
        }
      : null,
  ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
  const requestedTab = searchParams.get('tab');
  const activeTab = tabs.some((tab) => tab.value === requestedTab)
    ? (requestedTab ?? tabs[0].value)
    : tabs[0].value;
  const handleTabChange = (value: string) => {
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set('tab', value);
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };

  return (
    <ScoreCapabilityProvider
      capabilities={capabilities}
      scoreId={id}
      workspace="view"
    >
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <ScoreBreadcrumbs scoreDisplayTitle={scoreDisplayTitle} />
          <ScoreDetailHero
            title={scoreDisplayTitle}
            thumbnailUrl={
              previewAsset.status === 'ready'
                ? scoreThumbnailUrl(previewAsset.asset_id)
                : null
            }
            thumbnailLoading={imagePreparing}
            playbackAudioSrc={playbackAudioSrc}
            playbackEnabled={Boolean(playbackAudioSrc)}
            playbackLoading={audioPreparing}
            playbackVisible={score.capabilities.can_practice}
            actions={
              <>
                <ScoreHeroActions
                  imagePreparing={imagePreparing}
                  revisionAssets={resources.revisionAssets}
                  revisionId={score.head_revision_id}
                  scoreId={score.score_id}
                />
                {score.capabilities.can_delete ? (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      deleteScores.reset();
                      setDeleteOpen(true);
                    }}
                  >
                    {t('deleteScore')}
                  </Button>
                ) : score.capabilities.can_leave ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      leaveScore.reset();
                      setLeaveOpen(true);
                    }}
                  >
                    {t('leaveScore')}
                  </Button>
                ) : null}
              </>
            }
            meta={
              <>
                <span>
                  {t('lastModifiedTime')} {formatApiDateTime(score.updated_at)}
                </span>
                <span aria-hidden="true">·</span>
                {score.head_revision_number !== null ? (
                  <span>{t('versionLabel', { version: score.head_revision_number })}</span>
                ) : null}
              </>
            }
          />
          <ScoreDeleteDialog
            open={deleteOpen}
            titles={[scoreDisplayTitle]}
            pending={deleteScores.isPending}
            error={deleteScores.error}
            onOpenChange={setDeleteOpen}
            onConfirm={() => {
              if (!score.capabilities.can_delete) return;
              deleteScores.mutate([score.score_id], {
                onSuccess: () => router.push('/library?view=created_by_me'),
              });
            }}
          />
          <ScoreLeaveDialog
            open={leaveOpen}
            title={scoreDisplayTitle}
            pending={leaveScore.isPending}
            error={leaveScore.error}
            onOpenChange={setLeaveOpen}
            onConfirm={() => {
              if (!score.capabilities.can_leave) return;
              leaveScore.mutate(score.score_id, {
                onSuccess: () => router.push('/library?view=shared_with_me'),
              });
            }}
          />
          <ScoreDetailTabs
            tabs={tabs}
            value={activeTab}
            onValueChange={handleTabChange}
          />
        </div>
      </ScoreSurface>
    </ScoreCapabilityProvider>
  );
}

export default function ScoreDetailPage({ scoreId }: { scoreId: string }) {
  return <Suspense fallback={null}><ScorePageContent id={scoreId} /></Suspense>;
}
