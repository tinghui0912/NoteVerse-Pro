'use client';

import { Bookmark, ChevronDown, Download, ExternalLink, FileImage, FileMusic, Gamepad2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
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
  isSaving?: boolean;
  openAppHref?: string;
  practiceHref?: string;
  onDownloadImage?: () => void;
  onDownloadXml?: () => void;
  onSave?: () => void;
  saveHref?: string;
}

export function ExternalScoreActions({
  canSave,
  isSaving,
  onDownloadImage,
  onDownloadXml,
  onSave,
  openAppHref,
  practiceHref,
  saveHref,
}: ExternalScoreActionsProps) {
  const common = useTranslations('common');
  const score = useTranslations('score');
  const practice = useTranslations('practice');
  const share = useTranslations('share');
  const { capabilities } = useScoreCapabilities();
  const downloadAvailable = capabilities.can_download && (onDownloadImage || onDownloadXml);

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
            {onDownloadImage ? (
              <DropdownMenuItem onClick={onDownloadImage}>
                <FileImage className="mr-2 h-4 w-4" />
                {score('downloadImage')}
              </DropdownMenuItem>
            ) : null}
            {onDownloadXml ? (
              <DropdownMenuItem onClick={onDownloadXml}>
                <FileMusic className="mr-2 h-4 w-4" />
                {score('downloadMusicXML')}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {practiceHref && capabilities.can_practice ? (
        <Button asChild>
          <Link href={practiceHref}>
            <Gamepad2 className="mr-2 h-4 w-4" />
            {practice('mode')}
          </Link>
        </Button>
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
