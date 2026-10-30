// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import zhMessages from '../../../messages/zh/practice.json';
import { ContinuousPracticeControls, StepPracticeControls } from './practice-controls';

function renderControls(
  rangeSelectionActive: boolean,
  overrides: Partial<ComponentProps<typeof ContinuousPracticeControls>> = {}
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
      <ContinuousPracticeControls
        lifecycle="READY"
        isLoading={false}
        isPreparingSession={false}
        canPrepareSession
        audioWorkletSupported
        rangeSelectionActive={rangeSelectionActive}
        canSelectRange
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onEnd={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleRangeSelection={vi.fn()}
        {...overrides}
      />
    </NextIntlClientProvider>
  );
}

describe('ContinuousPracticeControls', () => {
  it('STEP active waiting renders Finish but never Pause or Resume', () => {
    const finish = vi.fn();
    render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}>
      <StepPracticeControls lifecycle="ACTIVE" isLoading={false} isPreparingSession={false} canPrepareSession
        rangeSelectionActive={false} canSelectRange={false} onStart={vi.fn()} onEnd={finish}
        onToggleRangeSelection={vi.fn()} />
    </NextIntlClientProvider>);
    expect(screen.queryByRole('button', { name: /pause|resume/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /settings/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: messages.finish })); expect(finish).toHaveBeenCalledOnce();
  });
  it('keeps the section button label stable while active', () => {
    renderControls(true);

    const button = screen.getByRole('button', { name: /section/i });
    expect(button).toHaveTextContent('Section');
    expect(button).toHaveClass('bg-slate-200');
  });

  it('renders settings inside the bottom controls', () => {
    renderControls(false);

    expect(screen.getByRole('button', { name: /settings/i })).toBeEnabled();
  });

  it('calls onPause when active and onResume when paused', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();

    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <ContinuousPracticeControls
          lifecycle="ACTIVE"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          audioWorkletSupported
          rangeSelectionActive={false}
          canSelectRange={false}
          onStart={vi.fn()}
          onPause={onPause}
          onResume={onResume}
          onEnd={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const pauseButton = screen.getByRole('button', { name: /pause/i });
    fireEvent.click(pauseButton);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <ContinuousPracticeControls
          lifecycle="PAUSED"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          audioWorkletSupported
          rangeSelectionActive={false}
          canSelectRange={false}
          onStart={vi.fn()}
          onPause={onPause}
          onResume={onResume}
          onEnd={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const resumeButton = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(resumeButton);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('renders interactive metronome toggle inside tempo popover that switches state', () => {
    const onMetronomeEnabledChange = vi.fn();
    const { rerender } = renderControls(false, {
      tempoSelection: { mode: 'SCORE' },
      onTempoSelectionChange: vi.fn(),
      metronomeEnabled: false,
      onMetronomeEnabledChange,
    });

    const tempoBtn = screen.getByRole('button', { name: /tempo/i });
    fireEvent.click(tempoBtn);

    const metronomeBtn = screen.getByRole('button', { name: /metronome sound/i });
    expect(metronomeBtn).toBeEnabled();
    expect(metronomeBtn).toHaveTextContent('Off');

    fireEvent.click(metronomeBtn);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(true);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <ContinuousPracticeControls
          lifecycle="ACTIVE"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          rangeSelectionActive={false}
          canSelectRange={false}
          tempoSelection={{ mode: 'SCORE' }}
          onTempoSelectionChange={vi.fn()}
          metronomeEnabled={true}
          onMetronomeEnabledChange={onMetronomeEnabledChange}
          onStart={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onEnd={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const activeMetronomeBtn = screen.getByRole('button', { name: /metronome sound/i });
    expect(activeMetronomeBtn).toBeEnabled();
    expect(activeMetronomeBtn).toHaveTextContent('On');
    fireEvent.click(activeMetronomeBtn);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(false);
  });

  it('renders real tempo control button in bottom bar', () => {
    const onTempoSelectionChange = vi.fn();
    renderControls(false, {
      tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 84 },
      onTempoSelectionChange,
    });

    const tempoBtn = screen.getByRole('button', { name: /tempo/i });
    expect(tempoBtn).toBeInTheDocument();
    expect(tempoBtn).toHaveTextContent('84 BPM');
  });

  it('enforces selectedInputSupported for start gating independently of audioWorkletSupported', () => {
    // When MIDI is selected, selectedInputSupported is true even if audioWorkletSupported is false
    const { rerender } = renderControls(false, {
      audioWorkletSupported: false,
      selectedInputSupported: true,
    });

    const startBtn = screen.getByRole('button', { name: /start/i });
    expect(startBtn).toBeEnabled();

    // When microphone is selected but not supported, start is disabled
    rerender(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <ContinuousPracticeControls
          lifecycle="READY"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          audioWorkletSupported={false}
          selectedInputSupported={false}
          rangeSelectionActive={false}
          canSelectRange
          onStart={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onEnd={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const disabledStartBtn = screen.getByRole('button', { name: /start/i });
    expect(disabledStartBtn).toBeDisabled();
  });

  it('enforces selectedInputCapability for start gating', () => {
    const { rerender } = renderControls(false, {
      selectedInputCapability: {
        supported: false,
        status: 'BROWSER_UNSUPPORTED',
        reason: 'BROWSER_UNSUPPORTED',
      },
    });

    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <ContinuousPracticeControls
          lifecycle="READY"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          selectedInputCapability={{
            supported: true,
            status: 'AVAILABLE',
          }}
          rangeSelectionActive={false}
          canSelectRange
          onStart={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onEnd={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /start/i })).toBeEnabled();
  });
});

it('Start owns compact binding busy state and prevents a second click', () => {
  const start = vi.fn(); renderControls(false, { isPreparingSession: true, onStart: start });
  const button = screen.getByRole('button', { name: messages.startingAttempt });
  expect(button).toBeDisabled(); expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button.querySelector('.animate-spin')).not.toBeNull(); fireEvent.click(button); expect(start).not.toHaveBeenCalled();
  expect(screen.queryByRole('status')).toBeNull();
});
it('STEP settings is a discoverable configuration navigation action without input editors', () => {
  const settings = vi.fn(); render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}>
    <StepPracticeControls lifecycle="READY" isLoading={false} isPreparingSession={false} canPrepareSession
      rangeSelectionActive={false} canSelectRange onStart={vi.fn()} onEnd={vi.fn()} onToggleRangeSelection={vi.fn()} onOpenSettings={settings} />
  </NextIntlClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: messages.settingsButton })); expect(settings).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: messages.settingMidi })).toBeNull();
});
it('recording duration has neutral visible timing and the real English accessible name', () => {
  renderControls(false, { lifecycle: 'ACTIVE', recordingSeconds: 65 });
  const indicator = screen.getByTestId('recording-indicator');
  expect(indicator).toHaveTextContent(/^01:05$/);
  expect(indicator).toHaveAccessibleName('Recording duration');
  expect(screen.queryByRole('status')).toBeNull();
});

it('both recording duration labels are unique parameter-free accessible labels in the real catalogs', () => {
  expect(messages.recordingDuration).toBe('Recording duration');
  expect(zhMessages.recordingDuration).toBe('录制时长');
  for (const [locale, catalog] of [['en', messages], ['zh', zhMessages]] as const) {
    expect(catalog.recordingDuration).not.toMatch(/[{}]/);
    const source = readFileSync(`messages/${locale}/practice.json`, 'utf8');
    expect(source.match(/"recordingDuration"\s*:/g)).toHaveLength(1);
  }
});
