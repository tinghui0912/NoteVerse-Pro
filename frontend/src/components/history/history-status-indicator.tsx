'use client';

import { CheckCircle2, Clock, LoaderCircle, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { UploadStatus } from './history-types';

const statusConfig: Record<UploadStatus, { labelKey: string; icon: React.ElementType; color: string; animation?: string }> = {
  completed: { labelKey: 'statusCompleted', icon: CheckCircle2, color: 'text-green-500' },
  'pending-review': { labelKey: 'statusPendingReview', icon: Clock, color: 'text-orange-500' },
  'in-progress': { labelKey: 'statusInProgress', icon: LoaderCircle, color: 'text-blue-500', animation: 'animate-spin' },
  queued: { labelKey: 'statusQueued', icon: Clock, color: 'text-yellow-500' },
  failed: { labelKey: 'statusFailed', icon: XCircle, color: 'text-red-500' },
};

export function HistoryStatusIndicator({ status, className }: { status: UploadStatus; className?: string }) {
  const t = useTranslations('history');
  const config = statusConfig[status];
  return (
    <div className={cn('flex items-center text-sm font-medium', config.color, className)}>
      <config.icon className={cn('mr-2 h-4 w-4', config.animation)} />
      <span>{t(config.labelKey as never)}</span>
    </div>
  );
}
