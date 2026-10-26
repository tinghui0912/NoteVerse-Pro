'use client';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { PracticeDeviceIssue as DeviceIssue } from '@/lib/practice/device/device-contract';

/** Exceptional page-device facts only; qualification and attempt failures have separate owners. */
export function PracticeDeviceIssue({ issue, onReconnect, onConfigure }: {
  issue: DeviceIssue; onReconnect(): void; onConfigure(): void;
}) {
  const t = useTranslations('practice');
  const temporary = issue.condition === 'INTERRUPTED';
  const condition = temporary ? 'deviceInterrupted' : issue.condition === 'PERMISSION_DENIED' ? 'devicePermissionDenied'
    : issue.condition === 'LOST' ? 'deviceDisconnected' : issue.condition === 'NOT_FOUND' ? 'deviceNotFound'
      : issue.condition === 'BUSY' ? 'deviceBusy' : 'deviceUnavailable';
  return <div role="status" data-testid="practice-device-issue" className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
    <span>{t(condition, { resource: t(`deviceResource_${issue.resource}`) })}</span>
    {!temporary && <>
      <Button size="sm" variant="outline" onClick={onReconnect}>{t(issue.condition === 'LOST' ? 'deviceReconnect' : 'deviceRetry')}</Button>
      <Button size="sm" variant="ghost" onClick={onConfigure}>{t('setupChangeConfiguration')}</Button>
    </>}
  </div>;
}
