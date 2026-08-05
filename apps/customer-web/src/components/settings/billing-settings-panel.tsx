'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/routing';
import { useStorageUsage } from '@/hooks/queries/use-storage-usage-query';
import { formatBytes } from '@/lib/storage/bytes';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';

function usagePercent(usedBytes: number, reservedBytes: number, limitBytes: number): number {
  if (limitBytes <= 0) return 0;
  return Math.min(((usedBytes + reservedBytes) / limitBytes) * 100, 100);
}

export function BillingSettingsPanel() {
  const t = useTranslations('settings.billing');
  const storageUsage = useStorageUsage();
  const usage = storageUsage.data?.data;
  const quota = usage?.quota;
  const percent = quota
    ? usagePercent(quota.used_bytes, quota.reserved_bytes, quota.limit_bytes)
    : 0;
  const isNearLimit = percent >= 90;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-950">{t('heading')}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">{t('description')}</p>
          </div>
          <Button asChild className="bg-orange-500 text-white hover:bg-orange-600">
            <Link href="/subscriptions">{t('viewPlans')}</Link>
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-950">{t('storage.title')}</h3>
            <p className="mt-1 text-sm text-gray-500">{t('storage.description')}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => void storageUsage.refetch()}
            disabled={storageUsage.isFetching}
            className="gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t('storage.refresh')}
          </Button>
        </div>

        {storageUsage.isLoading ? (
          <div className="mt-6 space-y-4">
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
              {t('storage.loadFailed')}
            </div>
            <p className="mt-1 text-red-600">{t('storage.loadFailedDesc')}</p>
          </div>
        ) : (
          <div className="mt-6 space-y-5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                <span className="font-medium text-gray-700">
                  {t('storage.usedOfLimit', {
                    used: formatBytes(quota.used_bytes + quota.reserved_bytes),
                    limit: formatBytes(quota.limit_bytes),
                  })}
                </span>
                <span className={isNearLimit ? 'font-semibold text-orange-600' : 'text-gray-500'}>
                  {Math.round(percent)}%
                </span>
              </div>
              <Progress
                value={percent}
                className="h-3 bg-gray-100 [&>div]:bg-orange-500"
              />
              {isNearLimit ? (
                <p className="mt-2 text-sm text-orange-600">{t('storage.nearLimit')}</p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {t('storage.used')}
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-950">
                  {formatBytes(quota.used_bytes)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {t('storage.reserved')}
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-950">
                  {formatBytes(quota.reserved_bytes)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {t('storage.available')}
                </p>
                <p className="mt-2 text-lg font-semibold text-gray-950">
                  {formatBytes(quota.available_bytes)}
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
