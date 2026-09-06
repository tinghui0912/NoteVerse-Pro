'use client';

import { Cable, Headphones, ListChecks, Mic, Music2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { PracticeConnectionStatus } from '@/lib/practice/practice-types';
import type { PracticeInputSource } from '@/generated/practice-api';
import type { PracticeSessionMode } from '@/lib/practice/session-policy';

type PracticeSettingsPanelProps = {
  className?: string;
  connectionStatus: PracticeConnectionStatus;
  hasMicPermission: boolean | null;
  audioWorkletSupported: boolean;
  midiSupported: boolean;
  hasMidiPermission: boolean | null;
  hasMidiInput: boolean | null;
  practiceMode: PracticeSessionMode;
  practiceModeLocked: boolean;
  inputSource: PracticeInputSource;
  microphoneInputLocked: boolean;
  midiInputLocked: boolean;
  showNextNoteHint: boolean;
  onPracticeModeChange: (practiceMode: PracticeSessionMode) => void;
  onInputSourceChange: (inputSource: PracticeInputSource) => void;
  onShowNextNoteHintChange: (checked: boolean) => void;
};

export function PracticeSettingsPanel({
  className,
  connectionStatus,
  hasMicPermission,
  audioWorkletSupported,
  midiSupported,
  hasMidiPermission,
  hasMidiInput,
  practiceMode,
  practiceModeLocked,
  inputSource,
  microphoneInputLocked,
  midiInputLocked,
  showNextNoteHint,
  onPracticeModeChange,
  onInputSourceChange,
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
  const midiState = !midiSupported
    ? t('settingMidiUnsupported')
    : hasMidiPermission === false
      ? t('settingMidiNeedsPermission')
      : hasMidiInput === false
        ? t('settingMidiNoInput')
        : connectionStatus === 'ready' && inputSource === 'MIDI'
          ? t('settingMidiConnected')
          : t('settingMidiBrowser');

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
        <section className="px-5 py-5" aria-labelledby="practice-mode-heading">
          <h3 id="practice-mode-heading" className="text-sm font-semibold text-slate-900">
            {t('settingsMode')}
          </h3>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-md border px-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                practiceMode === 'STEP_BY_STEP'
                  ? 'border-orange-200 bg-orange-50 text-slate-950'
                  : 'border-slate-200 hover:bg-slate-50'
              )}
              disabled={practiceModeLocked}
              onClick={() => onPracticeModeChange('STEP_BY_STEP')}
              aria-pressed={practiceMode === 'STEP_BY_STEP'}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-orange-600">
                <ListChecks className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{t('settingStepByStep')}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{t('settingStepByStepDesc')}</span>
              </span>
            </button>
            <button
              type="button"
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-md border px-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                practiceMode === 'CONTINUOUS_PLAY'
                  ? 'border-orange-200 bg-orange-50 text-slate-950'
                  : 'border-slate-200 hover:bg-slate-50'
              )}
              disabled={practiceModeLocked}
              onClick={() => onPracticeModeChange('CONTINUOUS_PLAY')}
              aria-pressed={practiceMode === 'CONTINUOUS_PLAY'}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-orange-600">
                <Music2 className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{t('settingContinuousPlay')}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{t('settingContinuousPlayDesc')}</span>
              </span>
            </button>
          </div>
        </section>

        <section className="px-5 py-5" aria-labelledby="practice-input-heading">
          <h3 id="practice-input-heading" className="text-sm font-semibold text-slate-900">
            {t('settingsInput')}
          </h3>
          <div className="mt-3 grid gap-2">
            <button
              type="button"
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-md border px-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                inputSource === 'MICROPHONE'
                  ? 'border-orange-200 bg-orange-50 text-slate-950'
                  : 'border-slate-200 hover:bg-slate-50'
              )}
              disabled={microphoneInputLocked}
              onClick={() => onInputSourceChange('MICROPHONE')}
              aria-pressed={inputSource === 'MICROPHONE'}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-orange-600">
                <Mic className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{t('settingMicrophone')}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{microphoneState}</span>
              </span>
            </button>
            <button
              type="button"
              className={cn(
                'flex min-h-14 items-center gap-3 rounded-md border px-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                inputSource === 'MIDI'
                  ? 'border-emerald-200 bg-emerald-50 text-slate-950'
                  : 'border-slate-200 hover:bg-slate-50'
              )}
              disabled={midiInputLocked || !midiSupported}
              onClick={() => onInputSourceChange('MIDI')}
              aria-pressed={inputSource === 'MIDI'}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-emerald-600">
                <Cable className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{t('settingMidi')}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{midiState}</span>
              </span>
            </button>
          </div>
        </section>

        {practiceMode === 'STEP_BY_STEP' ? (
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
        ) : null}

      </div>
    </aside>
  );
}
