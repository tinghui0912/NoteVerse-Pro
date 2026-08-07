'use client';

import { Headphones, Mic, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { PracticeConnectionStatus } from '@/lib/practice/practice-types';

type PracticeSettingsPanelProps = {
  className?: string;
  connectionStatus: PracticeConnectionStatus;
  hasMicPermission: boolean | null;
  audioWorkletSupported: boolean;
  showNextNoteHint: boolean;
  onShowNextNoteHintChange: (checked: boolean) => void;
};

export function PracticeSettingsPanel({
  className,
  connectionStatus,
  hasMicPermission,
  audioWorkletSupported,
  showNextNoteHint,
  onShowNextNoteHintChange,
}: PracticeSettingsPanelProps) {
  const t = useTranslations('practice');
  const microphoneState = !audioWorkletSupported
    ? t('settingMicrophoneUnsupported')
    : hasMicPermission === false
      ? t('settingMicrophoneNeedsPermission')
      : connectionStatus === 'ready'
        ? t('settingMicrophoneConnected')
        : t('settingMicrophoneBrowser');

  return (
    <aside className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm', className)}>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 pr-12">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{t('settingsTitle')}</h2>
          <p className="mt-1 text-xs text-slate-500">{t('settingsSubtitle')}</p>
        </div>
        <Sparkles className="h-4 w-4 text-orange-500" aria-hidden="true" />
      </div>

      <div className="divide-y divide-slate-100">
        <section className="px-5 py-5" aria-labelledby="practice-input-heading">
          <h3 id="practice-input-heading" className="text-sm font-semibold text-slate-900">
            {t('settingsInput')}
          </h3>
          <div className="mt-3 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600">
              <Mic className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">{t('settingMicrophone')}</p>
              <p className="mt-0.5 text-xs text-slate-500">{microphoneState}</p>
            </div>
          </div>
        </section>

        <section className="px-5 py-5" aria-labelledby="practice-follow-heading">
          <h3 id="practice-follow-heading" className="text-sm font-semibold text-slate-900">
            {t('settingsFollow')}
          </h3>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                <Headphones className="h-4 w-4" aria-hidden="true" />
              </span>
              <div>
                <label htmlFor="practice-next-note-hint" className="text-sm font-medium text-slate-900">
                  {t('settingNextNoteHint')}
                </label>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{t('settingNextNoteHintDesc')}</p>
              </div>
            </div>
            <Switch
              id="practice-next-note-hint"
              checked={showNextNoteHint}
              onCheckedChange={onShowNextNoteHintChange}
              aria-label={t('settingNextNoteHint')}
            />
          </div>
        </section>

      </div>
    </aside>
  );
}
