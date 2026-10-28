'use client';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, KeyboardMusic, LoaderCircle, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { PracticeDeviceHealth, PracticeDeviceIssue, PracticeDeviceResource } from '@/lib/practice/device/device-contract';
import { practiceDeviceIssueMessageKeys } from './practice-device-status';

/** Page-device facts only. Reconnection never owns a practice attempt. */
export function PracticeDeviceStatusPopover({ resource, health, issue, canReconnect, onReconnect }: {
  resource: PracticeDeviceResource; health: PracticeDeviceHealth | null; issue: PracticeDeviceIssue | null;
  canReconnect: boolean; onReconnect(): Promise<void>;
}) {
  const t = useTranslations('practice'), [busy, setBusy] = useState(false), reconnecting = useRef(false);
  const resourceLabel = t(`deviceResource_${resource}`);
  const condition = issue?.condition ?? (health === 'HEALTHY' ? null : health === 'INTERRUPTED' ? 'INTERRUPTED' : health === 'LOST' ? 'LOST' : 'UNAVAILABLE');
  const healthy = condition === null;
  const Icon = resource === 'camera' ? Camera : resource === 'midi' ? KeyboardMusic : Mic;
  const reconnect = async () => {
    if (reconnecting.current || !canReconnect || healthy || condition === 'INTERRUPTED') return;
    reconnecting.current = true; setBusy(true);
    try { await onReconnect(); } finally { reconnecting.current = false; setBusy(false); }
  };
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
      {!healthy && condition !== 'INTERRUPTED' && (canReconnect || busy) && <Button type="button" variant="outline" size="sm"
        className="mt-3" disabled={busy} aria-busy={busy} onClick={() => { void reconnect(); }}>
        {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{t('deviceReconnect')}
      </Button>}
    </PopoverContent>
  </Popover>;
}
