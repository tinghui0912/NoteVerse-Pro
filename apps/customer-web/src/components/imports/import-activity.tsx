'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SectionLoading } from '@/components/loading';
import { SectionErrorState, EmptyState } from '@/components/states';
import { PaginationControls } from '@/components/ui/pagination-controls';
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
import {
  useImportJobList,
  useRetryImportJob,
  useDeleteImportJob,
} from '@/hooks/queries/use-import-job-queries';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { ImportJobCard } from './import-job-card';
import type { ImportJobRead } from '@/generated/api';

export function ImportActivity() {
  const t = useTranslations('imports');
  const errors = useTranslations('errors');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<ImportJobRead | null>(null);
  const query = useImportJobList(page, 20);
  const retry = useRetryImportJob();
  const remove = useDeleteImportJob();
  const pagination = query.data;
  const mutationError = retry.error || remove.error;
  return (
    <section
      id="import-activity"
      className="mt-12 scroll-mt-20 space-y-5"
      aria-labelledby="import-activity-title"
    >
      <h2 id="import-activity-title" className="text-2xl font-bold">
        {t('title')}
      </h2>
      {mutationError ? (
        <SectionErrorState
          title={t('operationFailed')}
          description={userFacingErrorMessage(
            errors,
            mutationError,
            t('operationFailed'),
          )}
        />
      ) : null}
      {query.isLoading ? (
        <SectionLoading label={t('loading')} />
      ) : query.isError ? (
        <SectionErrorState
          title={t('loadFailed')}
          description={userFacingErrorMessage(
            errors,
            query.error,
            t('loadFailed'),
          )}
          retryLabel={t('retry')}
          onRetry={() => void query.refetch()}
        />
      ) : query.data?.items.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {query.data.items.map((job) => (
            <ImportJobCard
              key={job.job_id}
              job={job}
              retryPending={retry.isPending}
              deletePending={remove.isPending}
              onRetry={() =>
                retry.mutate(job.job_id, { onSuccess: () => setPage(1) })
              }
              onDelete={() => {
                remove.reset();
                setDeleteTarget(job);
              }}
            />
          ))}
        </div>
      ) : (
        <EmptyState title={t('empty')} />
      )}
      {pagination && pagination.total_pages > 1 ? (
        <PaginationControls
          page={pagination.page}
          totalPages={pagination.total_pages}
          canGoPrevious={pagination.page > 1}
          canGoNext={pagination.page < pagination.total_pages}
          onPageChange={setPage}
          t={t}
        />
      ) : null}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {remove.error ? (
            <SectionErrorState
              title={t('operationFailed')}
              description={userFacingErrorMessage(
                errors,
                remove.error,
                t('operationFailed'),
              )}
            />
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              {t('cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (
                  !deleteTarget ||
                  !['FAILURE', 'PENDING_REVIEW'].includes(deleteTarget.state)
                )
                  return;
                remove.mutate(deleteTarget.job_id, {
                  onSuccess: () => {
                    setDeleteTarget(null);
                    setPage(1);
                  },
                });
              }}
            >
              {t('deleteImport')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
