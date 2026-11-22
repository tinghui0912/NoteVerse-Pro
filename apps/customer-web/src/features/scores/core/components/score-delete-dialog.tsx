'use client';
import { useTranslations } from 'next-intl';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SectionErrorState } from '@/components/states';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';

export function ScoreDeleteDialog({
  open,
  titles,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  titles: string[];
  pending: boolean;
  error: unknown;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {titles.length === 1
              ? t('deleteScoreTitle', { title: titles[0] })
              : t('deleteScoresTitle', { count: titles.length })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('deleteScoreDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <SectionErrorState
            title={t('deleteFailed')}
            description={userFacingErrorMessage(
              errors,
              error,
              t('deleteFailed'),
            )}
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {common('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending || titles.length === 0}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {t('deleteScore')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
