'use client';

import { FileText, Music2, PencilLine, Repeat } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PracticeCompletionOutcome } from '@/lib/practice/completion-outcome';

interface PracticeCompletionDialogProps {
  open: boolean;
  audioUrl: string | null;
  outcome: PracticeCompletionOutcome;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onRestart: () => void;
  onAdjustSection?: () => void;
  onViewSummary: () => void;
  onStartFullPiecePerformance?: () => void;
}

export function PracticeCompletionDialog({
  open,
  audioUrl,
  outcome,
  isLoading,
  onOpenChange,
  onRestart,
  onAdjustSection,
  onViewSummary,
  onStartFullPiecePerformance,
}: PracticeCompletionDialogProps) {
  const t = useTranslations('practice');
  const isSelectedSection = outcome.kind === 'selected-section';
  const isFullPiecePerformance = outcome.kind === 'full-piece-performance';
  const title =
    outcome.kind === 'selected-section'
      ? t('selectedSectionCompletionDialogTitle')
      : outcome.kind === 'full-piece-performance'
        ? t('performanceCompletionDialogTitle')
        : t('learningCompletionDialogTitle');
  const description =
    outcome.kind === 'selected-section'
      ? t('selectedSectionCompletionDialogDesc')
      : outcome.kind === 'full-piece-performance'
        ? t('performanceCompletionDialogDesc')
        : t('learningCompletionDialogDesc');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {audioUrl ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('playback')}</p>
              <audio src={audioUrl} controls className="w-full" />
            </div>
          ) : outcome.expectsPlayback ? (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <InlineLoading label={t('preparingPlayback')} />
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={onRestart}>
              <Repeat className="mr-2 h-4 w-4" />
              {t('retryPractice')}
            </Button>
            {isSelectedSection ? (
              <Button
                type="button"
                onClick={onAdjustSection}
                disabled={!onAdjustSection}
              >
                <PencilLine className="mr-2 h-4 w-4" />
                {t('adjustSelectedSection')}
              </Button>
            ) : isFullPiecePerformance ? (
              <Button
                type="button"
                onClick={onViewSummary}
                disabled={isLoading || !outcome.canViewSummary}
                className="bg-orange-500 text-white hover:bg-orange-600"
              >
                {isLoading ? (
                  <InlineLoading />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                {t('viewSummary')}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onStartFullPiecePerformance}
                disabled={!outcome.canStartFullPiecePerformance || !onStartFullPiecePerformance}
                className="bg-orange-500 text-white hover:bg-orange-600"
              >
                <Music2 className="mr-2 h-4 w-4" />
                {t('startFullPiecePerformance')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
