'use client';

import { Bookmark, ChevronDown, Download, ExternalLink, FileImage, FileMusic } from 'lucide-react';
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
import type { ReactNode } from 'react';

interface ExternalScoreActionsProps {
  canSave?: boolean;
  imagePreparing?: boolean;
  isSaving?: boolean;
  openAppHref?: string;
  onDownloadImage?: () => void;
  onDownloadXml?: () => void;
  onSave?: () => void;
  saveHref?: string;
}

export function ExternalScoreActions({
  canSave,
  imagePreparing = false,
  isSaving,
  onDownloadImage,
  onDownloadXml,
  onSave,
  openAppHref,
  saveHref,
}: ExternalScoreActionsProps) {
  const common = useTranslations('common');
  const score = useTranslations('score');
  const share = useTranslations('share');
  const { capabilities } = useScoreCapabilities();
  const downloadAvailable = capabilities.can_download;

  const saveContent: ReactNode = (
    <>
      <Bookmark className="mr-2 h-4 w-4" />
      {share('saveToLibrary')}
    </>
  );

  return (
    <>
      {openAppHref ? (
        <Button asChild variant="outline" className="bg-white">
          <Link href={openAppHref}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {common('openApp')}
          </Link>
        </Button>
      ) : null}
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
              disabled={!onDownloadImage || imagePreparing}
              onClick={onDownloadImage}
            >
              {imagePreparing ? <InlineLoading /> : <FileImage className="mr-2 h-4 w-4" />}
              {score('downloadImage')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onDownloadXml} onClick={onDownloadXml}>
              <FileMusic className="mr-2 h-4 w-4" />
              {score('downloadMusicXML')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {canSave && onSave ? (
        <Button variant="outline" className="bg-white" onClick={onSave} disabled={isSaving}>
          {saveContent}
        </Button>
      ) : saveHref ? (
        <Button asChild variant="outline" className="bg-white">
          <Link href={saveHref}>{saveContent}</Link>
        </Button>
      ) : null}
    </>
  );
}
