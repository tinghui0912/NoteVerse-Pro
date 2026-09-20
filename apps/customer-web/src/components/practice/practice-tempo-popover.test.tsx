// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeTempoPopover } from './practice-tempo-popover';

describe('PracticeTempoPopover', () => {
  it('renders trigger button showing Score Tempo when explicit tempo exists', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'SCORE' }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 96 }]}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /tempo/i })).toHaveTextContent(/Score Tempo/);
  });

  it('renders trigger button showing Default 80 BPM when score has no explicit tempo', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'SCORE' }}
          scoreTempoSegments={[]}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /tempo/i })).toHaveTextContent('80 BPM');
  });

  it('renders trigger button showing exact custom BPM in CUSTOM mode', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'CUSTOM_FIXED_BPM', bpm: 72 }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 120 }]}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /tempo/i })).toHaveTextContent('72 BPM');
  });

  it('allows adjusting BPM directly via -5 and +5 buttons without separate mode tabs', () => {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'SCORE' }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 104 }]}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>
    );

    // Open popover
    fireEvent.click(screen.getByRole('button', { name: /tempo/i }));

    expect(screen.getByText(/Score: ♩ = 104 BPM/i)).toBeInTheDocument();
    expect(screen.getByText('104 BPM')).toBeInTheDocument();

    // Clicking +5 directly transitions SCORE -> CUSTOM_FIXED_BPM
    fireEvent.click(screen.getByRole('button', { name: '+5 BPM' }));
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 109,
    });

    // Clicking -5 directly transitions SCORE -> CUSTOM_FIXED_BPM
    fireEvent.click(screen.getByRole('button', { name: '-5 BPM' }));
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 99,
    });
  });

  it('allows restoring score tempo from custom mode', () => {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'CUSTOM_FIXED_BPM', bpm: 100 }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 120 }]}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /tempo/i }));

    const restoreBtn = screen.getByRole('button', { name: /restore score tempo/i });
    expect(restoreBtn).toBeEnabled();
    fireEvent.click(restoreBtn);
    expect(onTempoSelectionChange).toHaveBeenCalledWith({ mode: 'SCORE' });
  });

  it('toggles metronome sound within the same popover', () => {
    const onMetronomeEnabledChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'SCORE' }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 100 }]}
          metronomeEnabled={false}
          onMetronomeEnabledChange={onMetronomeEnabledChange}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /tempo/i }));

    const metronomeToggle = screen.getByRole('button', { name: /metronome sound/i });
    expect(metronomeToggle).toHaveTextContent('Off');
    fireEvent.click(metronomeToggle);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(true);
  });

  it('disables tempo controls while keeping metronome sound operable when tempoLocked is true', () => {
    const onMetronomeEnabledChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'CUSTOM_FIXED_BPM', bpm: 90 }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 90 }]}
          tempoLocked={true}
          metronomeEnabled={true}
          onMetronomeEnabledChange={onMetronomeEnabledChange}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /tempo/i }));

    expect(screen.getByText(/Tempo is locked while practice is active/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '-5 BPM' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+5 BPM' })).toBeDisabled();
    expect(screen.getByLabelText(/BPM Slider/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /restore score tempo/i })).toBeDisabled();

    // Metronome toggle is NOT locked
    const metronomeToggle = screen.getByRole('button', { name: /metronome sound/i });
    expect(metronomeToggle).toBeEnabled();
    expect(metronomeToggle).toHaveTextContent('On');
    fireEvent.click(metronomeToggle);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(false);
  });
});
