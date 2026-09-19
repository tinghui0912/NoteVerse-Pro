// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeControls } from './practice-controls';

function renderControls(
  rangeSelectionActive: boolean,
  overrides: Partial<ComponentProps<typeof PracticeControls>> = {}
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
      <PracticeControls
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
        onFinish={vi.fn()}
        onOpenSettings={vi.fn()}
        onToggleRangeSelection={vi.fn()}
        {...overrides}
      />
    </NextIntlClientProvider>
  );
}

describe('PracticeControls', () => {
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
        <PracticeControls
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
          onFinish={vi.fn()}
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
        <PracticeControls
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
          onFinish={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const resumeButton = screen.getByRole('button', { name: /resume/i });
    fireEvent.click(resumeButton);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('renders interactive metronome toggle that switches state', () => {
    const onMetronomeEnabledChange = vi.fn();
    const { rerender } = renderControls(false, {
      metronomeEnabled: false,
      onMetronomeEnabledChange,
    });

    const metronomeBtn = screen.getByRole('button', { name: /metronome/i });
    expect(metronomeBtn).toBeEnabled();
    expect(metronomeBtn).toHaveTextContent('♩ Off');

    fireEvent.click(metronomeBtn);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(true);

    rerender(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeControls
          lifecycle="ACTIVE"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          rangeSelectionActive={false}
          canSelectRange={false}
          metronomeEnabled={true}
          onMetronomeEnabledChange={onMetronomeEnabledChange}
          onStart={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onFinish={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    const activeMetronomeBtn = screen.getByRole('button', { name: /metronome/i });
    expect(activeMetronomeBtn).toBeEnabled();
    expect(activeMetronomeBtn).toHaveTextContent('♩ On');
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
        <PracticeControls
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
          onFinish={vi.fn()}
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
        status: 'MODEL_URL_NOT_CONFIGURED',
        reason: 'MODEL_URL_NOT_CONFIGURED',
      },
    });

    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeControls
          lifecycle="READY"
          isLoading={false}
          isPreparingSession={false}
          canPrepareSession
          selectedInputCapability={{
            supported: true,
            status: 'READY',
          }}
          rangeSelectionActive={false}
          canSelectRange
          onStart={vi.fn()}
          onPause={vi.fn()}
          onResume={vi.fn()}
          onFinish={vi.fn()}
          onOpenSettings={vi.fn()}
          onToggleRangeSelection={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /start/i })).toBeEnabled();
  });
});

