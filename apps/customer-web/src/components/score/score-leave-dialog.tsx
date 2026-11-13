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

export function ScoreLeaveDialog({
  open,
  title,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
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
          <AlertDialogTitle>{t('leaveScoreTitle', { title })}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('leaveScoreDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <SectionErrorState
            title={t('leaveFailed')}
            description={userFacingErrorMessage(
              errors,
              error,
              t('leaveFailed'),
            )}
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {common('cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {t('leaveScore')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
