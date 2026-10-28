'use client';
import { useTranslations } from 'next-intl';
import { Camera, KeyboardMusic, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { PracticeDeviceHealth, PracticeDeviceIssue, PracticeDeviceResource } from '@/lib/practice/device/device-contract';
import { practiceDeviceIssueMessageKeys } from './practice-device-status';

/** Read-only page-device facts. Qualification belongs to Practice Setup. */
export function PracticeDeviceStatusPopover({ resource, health, issue }: {
  resource: PracticeDeviceResource; health: PracticeDeviceHealth | null; issue: PracticeDeviceIssue | null;
}) {
  const t = useTranslations('practice');
  const resourceLabel = t(`deviceResource_${resource}`);
  const condition = issue?.condition ?? (health === 'HEALTHY' ? null : health === 'INTERRUPTED' ? 'INTERRUPTED' : health === 'LOST' ? 'LOST' : 'UNAVAILABLE');
  const healthy = condition === null;
  const Icon = resource === 'camera' ? Camera : resource === 'midi' ? KeyboardMusic : Mic;
  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className={cn('h-8 w-8 shrink-0', healthy ? 'text-emerald-600' : 'text-rose-600')}
        aria-label={t(healthy ? 'deviceStatusReady' : 'deviceStatusUnavailable', { resource: resourceLabel })}
        data-device-resource={resource} data-device-health={healthy ? 'HEALTHY' : condition}>
        <Icon className={cn('h-4 w-4', healthy ? 'text-emerald-600' : 'text-rose-600')} aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-64 p-4" aria-label={resourceLabel}>
      <h4 className="text-sm font-semibold text-slate-900">{resourceLabel}</h4>
      <p className="mt-2 text-sm text-slate-700">{healthy ? t('deviceConnected') : t(practiceDeviceIssueMessageKeys[condition], { resource: resourceLabel })}</p>
    </PopoverContent>
  </Popover>;
}
