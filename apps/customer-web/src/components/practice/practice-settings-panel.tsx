'use client';

import { Cable, Footprints, Headphones, Mic, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { PracticeConnectionStatus } from '@/lib/practice/practice-types';
import type { PracticeSessionPreset } from '@/lib/practice/session-policy';
import type { PracticeInputSource } from '@/generated/practice-api';

type PracticeSettingsPanelProps = {
  className?: string;
  connectionStatus: PracticeConnectionStatus;
  hasMicPermission: boolean | null;
  audioWorkletSupported: boolean;
  midiSupported: boolean;
  hasMidiPermission: boolean | null;
  hasMidiInput: boolean | null;
  preset: PracticeSessionPreset;
  presetLocked: boolean;
  inputSource: PracticeInputSource;
  microphoneInputLocked: boolean;
  midiInputLocked: boolean;
  showNextNoteHint: boolean;
  onPresetChange: (preset: PracticeSessionPreset) => void;
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
  preset,
  presetLocked,
  inputSource,
  microphoneInputLocked,
  midiInputLocked,
  showNextNoteHint,
  onPresetChange,
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
            {t('settingsPracticeStyle')}
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              className={cn(
                'flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                preset === 'STEP_BY_STEP'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-950'
              )}
              onClick={() => onPresetChange('STEP_BY_STEP')}
              disabled={presetLocked}
              aria-pressed={preset === 'STEP_BY_STEP'}
            >
              <Footprints className="h-4 w-4" aria-hidden="true" />
              <span>{t('settingModeStepByStep')}</span>
            </button>
            <button
              type="button"
              className={cn(
                'flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                preset === 'CONTINUOUS_PLAY'
                  ? 'bg-white text-slate-950 shadow-sm'
                  : 'text-slate-600 hover:bg-white/70 hover:text-slate-950'
              )}
              onClick={() => onPresetChange('CONTINUOUS_PLAY')}
              disabled={presetLocked}
              aria-pressed={preset === 'CONTINUOUS_PLAY'}
            >
              <Headphones className="h-4 w-4" aria-hidden="true" />
              <span>{t('settingModeContinuousPerformance')}</span>
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
