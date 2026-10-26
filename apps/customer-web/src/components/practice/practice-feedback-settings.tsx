'use client';
import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';

export function PracticeFeedbackSettings({ enabled, onChange }: { enabled: boolean; onChange(enabled: boolean): void }) {
  const t = useTranslations('practice'), id = useId();
  return <div className="flex items-center justify-between gap-4 p-5">
    <label htmlFor={id} className="text-sm font-medium">{t('liveNoteFeedback')}</label>
    <Switch id={id} checked={enabled} onCheckedChange={onChange} />
  </div>;
}
