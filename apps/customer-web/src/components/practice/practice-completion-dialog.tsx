'use client';

import { FileText, PencilLine, Repeat } from 'lucide-react';
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
import type { PracticeSessionMode } from '@/lib/practice/session-policy';

interface PracticeCompletionDialogProps {
  open: boolean;
  outcome: PracticeCompletionOutcome;
  sessionMode: PracticeSessionMode;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onRestart: () => void;
  onAdjustSection?: () => void;
  onViewSummary: () => void;
}

export function PracticeCompletionDialog({
  open,
  outcome,
  sessionMode,
  isLoading,
  onOpenChange,
  onRestart,
  onAdjustSection,
  onViewSummary,
}: PracticeCompletionDialogProps) {
  const t = useTranslations('practice');
  const isPerformance = sessionMode === 'CONTINUOUS_PLAY';
  const showSectionPractice = !isPerformance;
  const sectionPracticeLabel =
    outcome.kind === 'selected-section'
      ? t('adjustSectionPractice')
      : t('sectionPractice');
  const title =
    isPerformance
      ? t('performanceCompletionDialogTitle')
      : outcome.kind === 'selected-section'
      ? t('selectedSectionCompletionDialogTitle')
      : t('learningCompletionDialogTitle');
  const description =
    isPerformance
      ? t('performanceCompletionDialogDesc')
      : outcome.kind === 'selected-section'
      ? t('selectedSectionCompletionDialogDesc')
      : t('learningCompletionDialogDesc');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button type="button" variant="outline" onClick={onRestart}>
              <Repeat className="mr-2 h-4 w-4" />
              {t('retryPractice')}
            </Button>
            {showSectionPractice ? (
              <Button
                type="button"
                onClick={onAdjustSection}
                disabled={!onAdjustSection}
              >
                <PencilLine className="mr-2 h-4 w-4" />
                {sectionPracticeLabel}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={onViewSummary}
                disabled={isLoading}
                className="bg-orange-500 text-white hover:bg-orange-600"
              >
                {isLoading ? (
                  <InlineLoading />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                {t('viewSummary')}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
