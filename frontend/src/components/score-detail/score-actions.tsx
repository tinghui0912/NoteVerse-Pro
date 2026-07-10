'use client';

import { useState } from 'react';
import { ChevronDown, Download, Edit, FileImage, FileMusic, Gamepad2, Globe2, Share2, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { InlineLoading } from '@/components/loading/inline-loading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScoreShareDialog } from '@/components/score-detail/score-share-dialog';
import { ScoreCollaborationDialog } from '@/components/score-detail/score-collaboration-dialog';
import { useDownload } from '@/hooks/use-download';
import {
  usePublishScore,
  useScorePublication,
  useUnpublishScore,
} from '@/hooks/queries/use-score-queries';
import { useScoreCapabilities } from '@/components/score/score-capability-context';
import type { ScoreArtifact } from '@/types/api';

export function ScoreActions({
  scoreTitle,
  scoreId,
  artifacts,
  revisionId,
}: {
  scoreTitle: string;
  scoreId: string;
  artifacts: ScoreArtifact[];
  revisionId?: string | null;
}) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const practice = useTranslations('practice');
  const publication = useScorePublication(scoreId);
  const publish = usePublishScore(scoreId);
  const unpublish = useUnpublishScore(scoreId);
  const { handleDownload } = useDownload({ mode: 'score', id: scoreId, artifacts });
  const [shareOpen, setShareOpen] = useState(false);
  const [collaborationOpen, setCollaborationOpen] = useState(false);
  const isPublished = publication.data?.data?.status === 'PUBLISHED';
  const { capabilities } = useScoreCapabilities();

  const buttonClass = 'h-16 w-full justify-start gap-3 bg-white px-4 text-left';
  const iconClass = 'h-5 w-5 shrink-0';
  return (
    <>
      <Card data-testid="score-actions" className="rounded-2xl bg-white shadow-lg">
        <CardHeader><CardTitle>{t('actionsTitle')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          {capabilities.can_download ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className={buttonClass}>
                  <Download className={iconClass} />
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    <span className="truncate">{common('download')}</span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => handleDownload('image')}><FileImage className="mr-2 h-4 w-4" />{t('downloadImage')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleDownload('xml')}><FileMusic className="mr-2 h-4 w-4" />{t('downloadMusicXML')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {capabilities.can_practice ? (
            <Button asChild variant="outline" className={buttonClass}>
              <Link href={`/score/${scoreId}/practice`}>
                <Gamepad2 className={iconClass} />
                <span className="truncate">{practice('mode')}</span>
              </Link>
            </Button>
          ) : null}
          {capabilities.can_edit ? (
            <Button asChild variant="outline" className={buttonClass}>
              <Link href={`/score/${scoreId}/edit`}>
                <Edit className={iconClass} />
                <span className="truncate">{common('edit')}</span>
              </Link>
            </Button>
          ) : null}
          {capabilities.can_manage_sharing ? (
            <Button variant="outline" className={buttonClass} onClick={() => setShareOpen(true)}>
              <Share2 className={iconClass} />
              <span className="truncate">{t('createShareAction')}</span>
            </Button>
          ) : null}
          {capabilities.can_manage_members ? (
            <Button variant="outline" className={buttonClass} onClick={() => setCollaborationOpen(true)}>
              <Users className={iconClass} />
              <span className="truncate">{t('collaborationAction')}</span>
            </Button>
          ) : null}
          {capabilities.can_publish ? (
            <Button
              variant="outline"
              className={`${buttonClass} col-span-2`}
              disabled={!revisionId || publish.isPending || unpublish.isPending}
              onClick={() => isPublished ? unpublish.mutate() : revisionId && publish.mutate(revisionId)}
            >
              {(publish.isPending || unpublish.isPending) ? <InlineLoading /> : <Globe2 className={iconClass} />}
              <span className="truncate">{t(isPublished ? 'unpublishScore' : 'publishScore')}</span>
            </Button>
          ) : null}
        </CardContent>
      </Card>
      {capabilities.can_manage_sharing ? (
        <ScoreShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          scoreTitle={scoreTitle}
          scoreId={scoreId}
        />
      ) : null}
      {capabilities.can_manage_members ? (
        <ScoreCollaborationDialog
          open={collaborationOpen}
          onOpenChange={setCollaborationOpen}
          scoreTitle={scoreTitle}
          scoreId={scoreId}
        />
      ) : null}
    </>
  );
}
