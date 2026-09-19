'use client';

import React from 'react';
import { Cable, ListChecks, Mic, Music2, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { LocalPracticeInputState } from '@/lib/practice/local-core/session';
import type {
  PracticeInputSource,
  PracticeMode,
} from '@/lib/practice/local-core/artifact';
import type {
  PracticeMicrophoneCapability,
  PracticeMidiCapability,
} from '@/lib/practice/input-capability';

type PracticeSettingsPanelProps = {
  className?: string;
  inputState?: LocalPracticeInputState;
  hasMicPermission?: boolean | null;
  microphoneCapability?: PracticeMicrophoneCapability;
  midiCapability?: PracticeMidiCapability;
  audioWorkletSupported?: boolean;
  midiSupported?: boolean;
  hasMidiPermission?: boolean | null;
  hasMidiInput?: boolean | null;
  practiceMode: PracticeMode;
  practiceModeLocked: boolean;
  inputSource: PracticeInputSource;
  microphoneInputLocked: boolean;
  midiInputLocked: boolean;
  onPracticeModeChange: (practiceMode: PracticeMode) => void;
  onInputSourceChange: (inputSource: PracticeInputSource) => void;
};

export function PracticeSettingsPanel({
  className,
  inputState = 'IDLE',
  hasMicPermission = null,
  microphoneCapability,
  midiCapability,
  audioWorkletSupported,
  midiSupported,
  hasMidiPermission = null,
  hasMidiInput = null,
  practiceMode,
  practiceModeLocked,
  inputSource,
  microphoneInputLocked,
  midiInputLocked,
  onPracticeModeChange,
  onInputSourceChange,
}: PracticeSettingsPanelProps) {
  const t = useTranslations('practice');
  const microphoneState = microphoneCapability
    ? microphoneCapability.status === 'MODEL_ACCESS_UNAVAILABLE'
      ? t('micModelAccessUnavailable')
      : microphoneCapability.status === 'MODEL_STORAGE_UNAVAILABLE'
        ? t('micModelStorageUnavailable')
        : microphoneCapability.status === 'BROWSER_UNSUPPORTED'
          ? t('settingMicrophoneUnsupported')
          : hasMicPermission === false
            ? t('settingMicrophoneNeedsPermission')
            : inputState === 'RUNNING' && inputSource === 'MICROPHONE'
              ? t('settingMicrophoneConnected')
              : t('settingMicrophoneBrowser')
    : audioWorkletSupported === false
      ? t('settingMicrophoneUnsupported')
      : hasMicPermission === false
        ? t('settingMicrophoneNeedsPermission')
        : inputState === 'RUNNING' && inputSource === 'MICROPHONE'
          ? t('settingMicrophoneConnected')
          : t('settingMicrophoneBrowser');

  const midiState = midiCapability
    ? midiCapability.status === 'BROWSER_UNSUPPORTED'
      ? t('settingMidiUnsupported')
      : hasMidiPermission === false
        ? t('settingMidiNeedsPermission')
        : midiCapability.status === 'NO_CONNECTED_INPUT' || hasMidiInput === false
          ? t('settingMidiNoInput')
          : inputState === 'RUNNING' && inputSource === 'MIDI'
            ? t('settingMidiConnected')
            : t('settingMidiBrowser')
    : midiSupported === false
      ? t('settingMidiUnsupported')
      : hasMidiPermission === false
        ? t('settingMidiNeedsPermission')
        : hasMidiInput === false
          ? t('settingMidiNoInput')
          : inputState === 'RUNNING' && inputSource === 'MIDI'
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
              disabled={midiInputLocked || (midiCapability ? midiCapability.status === 'BROWSER_UNSUPPORTED' : midiSupported === false)}
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
      </div>
    </aside>
  );
}
