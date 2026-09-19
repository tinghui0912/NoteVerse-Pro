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

    expect(screen.getByRole('button', { name: /tempo/i })).toHaveTextContent('Score Tempo');
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

    expect(screen.getByRole('button', { name: /tempo/i })).toHaveTextContent('Default 80 BPM');
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

  it('allows opening popover and switching between SCORE and CUSTOM modes', () => {
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

    const customButton = screen.getByRole('button', { name: 'Custom' });
    fireEvent.click(customButton);
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 104,
    });
  });

  it('adjusts BPM via -5, +5 buttons and slider in CUSTOM mode', () => {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'CUSTOM_FIXED_BPM', bpm: 100 }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 100 }]}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /tempo/i }));

    expect(screen.getAllByText('100 BPM').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: '-5 BPM' }));
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 95,
    });

    fireEvent.click(screen.getByRole('button', { name: '+5 BPM' }));
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 105,
    });

    const slider = screen.getByLabelText(/BPM Slider/i);
    fireEvent.change(slider, { target: { value: '120' } });
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 120,
    });
  });

  it('disables controls and displays lock notice when tempoLocked is true', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeTempoPopover
          tempoSelection={{ mode: 'CUSTOM_FIXED_BPM', bpm: 90 }}
          scoreTempoSegments={[{ startBeat: 0, bpm: 90 }]}
          tempoLocked={true}
          onTempoSelectionChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /tempo/i }));

    expect(screen.getByText(/Tempo is locked while practice is active/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Score Tempo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Custom' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '-5 BPM' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+5 BPM' })).toBeDisabled();
    expect(screen.getByLabelText(/BPM Slider/i)).toBeDisabled();
  });
});
