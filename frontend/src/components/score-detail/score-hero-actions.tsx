'use client';

import { ChevronDown, Download, Edit, FileImage, FileMusic, Gamepad2, Globe2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useScoreCapabilities } from '@/components/score/score-capability-context';
import {
  usePublishScore,
  useScorePublication,
  useUnpublishScore,
} from '@/hooks/queries/use-score-queries';
import { useDownload } from '@/hooks/use-download';
import type { ScoreArtifact } from '@/types/api';

interface ScoreHeroActionsProps {
  artifacts: ScoreArtifact[];
  revisionId?: string | null;
  scoreId: string;
}

export function ScoreHeroActions({ artifacts, revisionId, scoreId }: ScoreHeroActionsProps) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const practice = useTranslations('practice');
  const { capabilities } = useScoreCapabilities();
  const { handleDownload } = useDownload({ mode: 'score', id: scoreId, artifacts });
  const publication = useScorePublication(scoreId);
  const publish = usePublishScore(scoreId);
  const unpublish = useUnpublishScore(scoreId);
  const isPublished = publication.data?.data?.status === 'PUBLISHED';
  const publishBusy = publish.isPending || unpublish.isPending;
  const renderedPages = artifacts.filter((item) => item.kind === 'RENDERED_PAGE');
  const musicXml = artifacts.find((item) => item.kind === 'MUSICXML');
  const canDownloadImage = renderedPages.length > 0;
  const canDownloadXml = Boolean(musicXml);
  const downloadAvailable = capabilities.can_download && (canDownloadImage || canDownloadXml);

  return (
    <>
      {downloadAvailable ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="bg-white">
              <Download className="mr-2 h-4 w-4" />
              {common('download')}
              <ChevronDown className="ml-2 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {canDownloadImage ? (
              <DropdownMenuItem onClick={() => handleDownload('image')}>
                <FileImage className="mr-2 h-4 w-4" />
                {t('downloadImage')}
              </DropdownMenuItem>
            ) : null}
            {canDownloadXml ? (
              <DropdownMenuItem onClick={() => handleDownload('xml')}>
                <FileMusic className="mr-2 h-4 w-4" />
                {t('downloadMusicXML')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {capabilities.can_edit ? (
        <Button asChild variant="outline" className="bg-white">
          <Link href={`/score/${scoreId}/edit`}>
            <Edit className="mr-2 h-4 w-4" />
            {common('edit')}
          </Link>
        </Button>
      ) : null}
      {capabilities.can_practice ? (
        <Button asChild>
          <Link href={`/score/${scoreId}/practice`}>
            <Gamepad2 className="mr-2 h-4 w-4" />
            {practice('mode')}
          </Link>
        </Button>
      ) : null}
      {capabilities.can_publish ? (
        <Button
          variant={isPublished ? 'outline' : 'secondary'}
          className="bg-white"
          disabled={!revisionId || publishBusy}
          onClick={() => {
            if (isPublished) {
              unpublish.mutate();
              return;
            }
            if (revisionId) publish.mutate(revisionId);
          }}
        >
          {publishBusy ? <InlineLoading /> : <Globe2 className="mr-2 h-4 w-4" />}
          {t(isPublished ? 'unpublishScore' : 'publishScore')}
        </Button>
      ) : null}
    </>
  );
}
