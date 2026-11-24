'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useStorageUsage } from '@/features/storage-usage/queries';
import { formatBytes, usagePercent } from './presentation';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

export function StorageSettingsPanel() {
  const t = useTranslations('settings.storage');
  const storageUsage = useStorageUsage();
  const usage = storageUsage.data;
  const quota = usage?.quota;
  const percent = quota
    ? usagePercent(quota.used_bytes, quota.reserved_bytes, quota.limit_bytes)
    : 0;
  const isNearLimit = percent !== null && percent >= 90;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-950">{t('title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('description')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void storageUsage.refetch()}
            disabled={storageUsage.isFetching}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t('refresh')}
          </Button>
        </div>

        {storageUsage.isLoading ? (
          <div role="status" aria-label={t('loading')} className="mt-6 space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-full rounded-full" />
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          </div>
        ) : storageUsage.isError || !quota ? (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4" />
              {t('loadFailed')}
            </div>
            <p className="mt-1 text-red-600">{t('loadFailedDesc')}</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-gray-700">
                  {t('usedOfLimit', {
                    used: formatBytes(quota.used_bytes + quota.reserved_bytes),
                    limit: quota.limit_bytes === null ? t('unlimited') : formatBytes(quota.limit_bytes),
                  })}
                </span>
                <span className={isNearLimit ? 'font-semibold text-orange-600' : 'text-gray-500'}>
                  {percent === null ? t('unlimited') : `${Math.round(percent)}%`}
                </span>
              </div>
              {percent !== null ? <Progress
                aria-label={t('title')}
                aria-valuenow={percent}
                value={percent}
                className="h-3 bg-gray-100 [&>div]:bg-orange-500"
              /> : null}
              {isNearLimit ? (
                <p className="mt-2 text-sm text-orange-600">{t(quota.limit_bytes !== null && quota.limit_bytes <= 0 ? 'noCapacity' : percent !== null && percent >= 100 ? 'full' : 'nearLimit')}</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {t('used')}
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-950">
                  {formatBytes(quota.used_bytes)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {t('reserved')}
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-950">
                  {formatBytes(quota.reserved_bytes)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {t('available')}
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-950">
                  {quota.available_bytes === null ? t('unlimited') : formatBytes(quota.available_bytes)}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
