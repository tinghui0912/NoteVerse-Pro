'use client';
import { scoreEditLocation } from '@/features/scores/routes';

import { ChevronDown, Download, Edit, FileImage, FileMusic, Gamepad2 } from 'lucide-react';
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
import { useScoreCapabilities } from '@/features/scores/core/components/score-capability-context';
import { useScoreDownload } from '@/features/scores/core/use-score-download';
import { scoreDownloadAvailability } from '@/features/scores/core/detail/download-availability';
import type { ScoreRevisionAssetsRead } from '@/generated/api';
import { practiceLocation } from '@/lib/practice/configuration/practice-location';

interface ScoreHeroActionsProps {
  imagePreparing?: boolean;
  revisionAssets: ScoreRevisionAssetsRead;
  revisionId?: string | null;
  scoreId: string;
}

export function ScoreHeroActions({
  imagePreparing = false,
  revisionAssets,
  revisionId,
  scoreId,
}: ScoreHeroActionsProps) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const { capabilities } = useScoreCapabilities();
  const { handleDownload } = useScoreDownload({  id: scoreId, assets: revisionAssets });
  const downloads = scoreDownloadAvailability(revisionAssets);
  const downloadAvailable = capabilities.can_download;

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
            <DropdownMenuItem
              disabled={!downloads.canDownloadImage || imagePreparing}
              onClick={() => handleDownload('image')}
            >
              {imagePreparing ? <InlineLoading /> : <FileImage className="mr-2 h-4 w-4" />}
              {t('downloadImage')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!downloads.canDownloadXml}
              onClick={() => handleDownload('xml')}
            >
              <FileMusic className="mr-2 h-4 w-4" />
              {t('downloadMusicXML')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {capabilities.can_edit ? (
        <Button asChild variant="outline" className="bg-white">
          <Link href={scoreEditLocation(scoreId)}>
            <Edit className="mr-2 h-4 w-4" />
            {common('edit')}
          </Link>
        </Button>
      ) : null}
      {capabilities.can_practice ? (
        <Button asChild>
          <Link href={practiceLocation(scoreId, 'setup', revisionId)}>
            <Gamepad2 className="mr-2 h-4 w-4" />
            {t('practiceScore')}
          </Link>
        </Button>
      ) : null}
    </>
  );
}
