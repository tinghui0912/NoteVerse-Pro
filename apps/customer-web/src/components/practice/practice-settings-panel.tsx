'use client';

import {
  Cable,
  ListChecks,
  Mic,
  Minus,
  Music2,
  Plus,
  RotateCcw,
  Sparkles,
  Timer,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { LocalPracticeInputState } from '@/lib/practice/local-core/session';
import type {
  PracticeInputSource,
  PracticeMode,
  TempoSegment,
} from '@/lib/practice/local-core/artifact';
import {
  MAX_PRACTICE_TEMPO_BPM,
  MIN_PRACTICE_TEMPO_BPM,
  clampCustomTempo,
  effectiveScoreTempoAtBeat,
  type PracticeTempoSelection,
} from '@/lib/practice/local-core/practice-tempo';

type PracticeSettingsPanelProps = {
  className?: string;
  inputState?: LocalPracticeInputState;
  hasMicPermission?: boolean | null;
  audioWorkletSupported: boolean;
  midiSupported: boolean;
  hasMidiPermission?: boolean | null;
  hasMidiInput?: boolean | null;
  practiceMode: PracticeMode;
  practiceModeLocked: boolean;
  inputSource: PracticeInputSource;
  microphoneInputLocked: boolean;
  midiInputLocked: boolean;
  onPracticeModeChange: (practiceMode: PracticeMode) => void;
  onInputSourceChange: (inputSource: PracticeInputSource) => void;
  tempoSelection?: PracticeTempoSelection;
  tempoLocked?: boolean;
  scoreTempoSegments?: readonly TempoSegment[];
  scopeStartBeat?: number;
  onTempoSelectionChange?: (selection: PracticeTempoSelection) => void;
  metronomeEnabled?: boolean;
  onMetronomeEnabledChange?: (enabled: boolean) => void;
};

export function PracticeSettingsPanel({
  className,
  inputState = 'IDLE',
  hasMicPermission = null,
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
  tempoSelection = { mode: 'SCORE' },
  tempoLocked = false,
  scoreTempoSegments = [],
  scopeStartBeat = 0,
  onTempoSelectionChange = () => {},
  metronomeEnabled = false,
  onMetronomeEnabledChange = () => {},
}: PracticeSettingsPanelProps) {
  const t = useTranslations('practice');
  const microphoneState = !audioWorkletSupported
    ? t('settingMicrophoneUnsupported')
    : hasMicPermission === false
      ? t('settingMicrophoneNeedsPermission')
      : inputState === 'RUNNING' && inputSource === 'MICROPHONE'
        ? t('settingMicrophoneConnected')
        : t('settingMicrophoneBrowser');
  const midiState = !midiSupported
    ? t('settingMidiUnsupported')
    : hasMidiPermission === false
      ? t('settingMidiNeedsPermission')
      : hasMidiInput === false
        ? t('settingMidiNoInput')
        : inputState === 'RUNNING' && inputSource === 'MIDI'
          ? t('settingMidiConnected')
          : t('settingMidiBrowser');

  const effectiveTempo = effectiveScoreTempoAtBeat(scoreTempoSegments, scopeStartBeat);
  const initialBpm = effectiveTempo.bpm;
  const hasExplicit = !effectiveTempo.isDefault;
  const hasChanges = effectiveTempo.hasSubsequentChanges;

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

        <section className="px-5 py-5" aria-labelledby="practice-tempo-heading">
          <div className="flex items-center justify-between">
            <h3 id="practice-tempo-heading" className="text-sm font-semibold text-slate-900">
              {t('settingsTempoAndMetronome')}
            </h3>
            <Timer className="h-4 w-4 text-slate-400" aria-hidden="true" />
          </div>

          <p className="mt-1 text-xs text-slate-500">
            {hasExplicit
              ? hasChanges
                ? t('tempoOriginalWithChanges', { bpm: initialBpm })
                : t('tempoOriginal', { bpm: initialBpm })
              : t('tempoOriginalDefault')}
          </p>

          {tempoLocked ? (
            <p className="mt-1 text-xs text-amber-600">{t('tempoLockedNotice')}</p>
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={tempoLocked}
              onClick={() => onTempoSelectionChange({ mode: 'SCORE' })}
              className={cn(
                'flex items-center justify-center rounded-md border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                tempoSelection.mode === 'SCORE'
                  ? 'border-orange-200 bg-orange-50 font-semibold text-orange-950'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              )}
              aria-pressed={tempoSelection.mode === 'SCORE'}
            >
              {t('tempoScoreMode')}
            </button>
            <button
              type="button"
              disabled={tempoLocked}
              onClick={() => {
                if (tempoSelection.mode === 'SCORE') {
                  onTempoSelectionChange({
                    mode: 'CUSTOM_FIXED_BPM',
                    bpm: initialBpm,
                  });
                }
              }}
              className={cn(
                'flex items-center justify-center rounded-md border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                tempoSelection.mode === 'CUSTOM_FIXED_BPM'
                  ? 'border-orange-200 bg-orange-50 font-semibold text-orange-950'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
              )}
              aria-pressed={tempoSelection.mode === 'CUSTOM_FIXED_BPM'}
            >
              {t('tempoCustomMode')}
            </button>
          </div>

          {tempoSelection.mode === 'CUSTOM_FIXED_BPM' ? (
            <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="-5 BPM"
                  disabled={tempoLocked || tempoSelection.bpm <= MIN_PRACTICE_TEMPO_BPM}
                  onClick={() =>
                    onTempoSelectionChange({
                      mode: 'CUSTOM_FIXED_BPM',
                      bpm: clampCustomTempo(tempoSelection.bpm - 5),
                    })
                  }
                  className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="text-sm font-semibold tabular-nums text-slate-900">
                  {tempoSelection.bpm} BPM
                </span>
                <button
                  type="button"
                  aria-label="+5 BPM"
                  disabled={tempoLocked || tempoSelection.bpm >= MAX_PRACTICE_TEMPO_BPM}
                  onClick={() =>
                    onTempoSelectionChange({
                      mode: 'CUSTOM_FIXED_BPM',
                      bpm: clampCustomTempo(tempoSelection.bpm + 5),
                    })
                  }
                  className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2.5">
                <input
                  type="range"
                  min={MIN_PRACTICE_TEMPO_BPM}
                  max={MAX_PRACTICE_TEMPO_BPM}
                  step={1}
                  value={tempoSelection.bpm}
                  disabled={tempoLocked}
                  onChange={(e) =>
                    onTempoSelectionChange({
                      mode: 'CUSTOM_FIXED_BPM',
                      bpm: clampCustomTempo(Number(e.target.value)),
                    })
                  }
                  aria-label="BPM Slider"
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                  <span>{MIN_PRACTICE_TEMPO_BPM}</span>
                  <span>{MAX_PRACTICE_TEMPO_BPM}</span>
                </div>
              </div>

              <div className="mt-2 flex justify-center border-t border-slate-200/60 pt-2">
                <button
                  type="button"
                  disabled={tempoLocked}
                  onClick={() => onTempoSelectionChange({ mode: 'SCORE' })}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>{hasExplicit ? t('restoreOriginalTempo') : t('restoreDefaultTempo')}</span>
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between rounded-md border border-slate-200 p-3">
            <div>
              <span className="block text-sm font-medium text-slate-900">{t('metronome')}</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {t('metronomeDescription')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => onMetronomeEnabledChange(!metronomeEnabled)}
              className={cn(
                'shrink-0 rounded-md px-3 py-1 text-xs font-semibold transition-colors',
                metronomeEnabled
                  ? 'bg-orange-500 text-white shadow-sm hover:bg-orange-600'
                  : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              )}
              aria-pressed={metronomeEnabled}
            >
              {metronomeEnabled ? t('metronomeOn') : t('metronomeOff')}
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
      </div>
    </aside>
  );
}
