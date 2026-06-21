'use client';

import { useState } from 'react';
import { ChevronDown, Download, Edit, FileImage, FileMusic, Gamepad2, Hand, Loader2, Share2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ResultsShareDialog } from '@/components/results/results-share-dialog';
import { useDownload } from '@/hooks/use-download';
import { useToast } from '@/hooks/use-toast';
import { useGenerateFingering } from '@/hooks/queries/use-xml-queries';
import { ApiError } from '@/lib/api-client';

export function ResultsActions({
  imageCount,
  scoreTitle,
  taskId,
}: {
  imageCount: number;
  scoreTitle: string;
  taskId: string;
}) {
  const t = useTranslations('results');
  const common = useTranslations('common');
  const practice = useTranslations('practice');
  const errors = useTranslations('errors');
  const { toast } = useToast();
  const fingering = useGenerateFingering();
  const { handleDownload } = useDownload({ mode: 'task', id: taskId, imageCount });
  const [shareOpen, setShareOpen] = useState(false);

  const generateFingering = () => {
    fingering.mutate(
      { taskId },
      {
        onSuccess: (response) => toast(response.success
          ? { title: t('fingeringSuccess'), description: t('fingeringDesc') }
          : { title: t('fingeringFailed'), description: response.message || t('fingeringFailed'), variant: 'destructive' }),
        onError: (error) => toast({
          title: t('fingeringFailed'),
          description: error instanceof ApiError && error.code ? errors(error.code as never) : t('fingeringFailedDesc'),
          variant: 'destructive',
        }),
      }
    );
  };

  const buttonClass = 'h-16 w-full justify-start gap-3 bg-white px-4 text-left';
  const iconClass = 'h-5 w-5 shrink-0';
  return (
    <>
      <Card data-testid="results-actions" className="rounded-2xl bg-white shadow-lg">
        <CardHeader><CardTitle>{t('actionsTitle')}</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
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
          <Button variant="outline" className={buttonClass} onClick={generateFingering} disabled={fingering.isPending}>
            {fingering.isPending ? <Loader2 className={`${iconClass} animate-spin`} /> : <Hand className={iconClass} />}
            <span className="truncate">{t('generateFingering')}</span>
          </Button>
          <Button asChild variant="outline" className={buttonClass}>
            <Link href={`/practice/${taskId}`}>
              <Gamepad2 className={iconClass} />
              <span className="truncate">{practice('mode')}</span>
            </Link>
          </Button>
          <Button asChild variant="outline" className={buttonClass}>
            <Link href={`/editor/${taskId}?source=final`}>
              <Edit className={iconClass} />
              <span className="truncate">{common('edit')}</span>
            </Link>
          </Button>
          <Button variant="outline" className={`${buttonClass} col-span-2`} onClick={() => setShareOpen(true)}>
            <Share2 className={iconClass} />
            <span className="truncate">{t('createShareAction')}</span>
          </Button>
        </CardContent>
      </Card>
      <ResultsShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        scoreTitle={scoreTitle}
        taskId={taskId}
      />
    </>
  );
}
