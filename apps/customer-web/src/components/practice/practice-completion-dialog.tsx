'use client';

import { FileText, Repeat } from 'lucide-react';
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

interface PracticeCompletionDialogProps {
  open: boolean;
  audioUrl: string | null;
  isLoading: boolean;
  canViewPerformance: boolean;
  onOpenChange: (open: boolean) => void;
  onRestart: () => void;
  onViewPerformance: () => void;
}

export function PracticeCompletionDialog({
  open,
  audioUrl,
  isLoading,
  canViewPerformance,
  onOpenChange,
  onRestart,
  onViewPerformance,
}: PracticeCompletionDialogProps) {
  const t = useTranslations('practice');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('completionDialogTitle')}</DialogTitle>
          <DialogDescription>{t('completionDialogDesc')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {audioUrl ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('playback')}</p>
              <audio src={audioUrl} controls className="w-full" />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              <InlineLoading label={t('preparingPlayback')} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={onRestart}>
              <Repeat className="mr-2 h-4 w-4" />
              {t('retryPractice')}
            </Button>
            <Button
              type="button"
              onClick={onViewPerformance}
              disabled={isLoading || !canViewPerformance}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {isLoading ? (
                <InlineLoading />
              ) : (
                <FileText className="mr-2 h-4 w-4" />
              )}
              {t('viewPerformance')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
