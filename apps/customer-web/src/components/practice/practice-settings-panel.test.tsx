// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeSettingsPanel } from './practice-settings-panel';

describe('PracticeSettingsPanel', () => {
  it('keeps microphone and MIDI selectable before step-by-step practice starts', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          inputState="IDLE"
          hasMicPermission={null}
          audioWorkletSupported
          midiSupported
          hasMidiPermission={null}
          hasMidiInput
          practiceMode="STEP_BY_STEP"
          practiceModeLocked={false}
          inputSource="MICROPHONE"
          microphoneInputLocked={false}
          midiInputLocked={false}
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /microphone/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /midi keyboard/i })).toBeEnabled();
  });

  it('keeps microphone and MIDI selectable before continuous play starts', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          inputState="IDLE"
          hasMicPermission={null}
          audioWorkletSupported
          midiSupported
          hasMidiPermission={null}
          hasMidiInput
          practiceMode="CONTINUOUS_PLAY"
          practiceModeLocked={false}
          inputSource="MICROPHONE"
          microphoneInputLocked={false}
          midiInputLocked={false}
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /microphone/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /midi keyboard/i })).toBeEnabled();
  });

  it('renders original tempo when score tempo segments are provided', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          audioWorkletSupported
          midiSupported
          practiceMode="CONTINUOUS_PLAY"
          practiceModeLocked={false}
          inputSource="MICROPHONE"
          microphoneInputLocked={false}
          midiInputLocked={false}
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          scoreTempoSegments={[{ startBeat: 0, bpm: 96 }]}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(/Score: ♩ = 96 BPM/i)).toBeInTheDocument();
  });

  it('renders default 80 BPM notice when score has no explicit tempo', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          audioWorkletSupported
          midiSupported
          practiceMode="CONTINUOUS_PLAY"
          practiceModeLocked={false}
          inputSource="MICROPHONE"
          microphoneInputLocked={false}
          midiInputLocked={false}
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          scoreTempoSegments={[]}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(/No tempo specified in score, default: ♩ = 80 BPM/i)).toBeInTheDocument();
  });

  it('allows switching between SCORE mode and CUSTOM mode', () => {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          audioWorkletSupported
          midiSupported
          practiceMode="CONTINUOUS_PLAY"
          practiceModeLocked={false}
          inputSource="MICROPHONE"
          microphoneInputLocked={false}
          midiInputLocked={false}
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          scoreTempoSegments={[{ startBeat: 0, bpm: 104 }]}
          tempoSelection={{ mode: 'SCORE' }}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>
    );

    const customButton = screen.getByRole('button', { name: /Custom/i });
    fireEvent.click(customButton);
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 104,
    });
  });

  it('allows adjusting custom BPM via +/- buttons and slider', () => {
    const onTempoSelectionChange = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          audioWorkletSupported
          midiSupported
          practiceMode="CONTINUOUS_PLAY"
          practiceModeLocked={false}
          inputSource="MICROPHONE"
          microphoneInputLocked={false}
          midiInputLocked={false}
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          scoreTempoSegments={[{ startBeat: 0, bpm: 100 }]}
          tempoSelection={{ mode: 'CUSTOM_FIXED_BPM', bpm: 100 }}
          onTempoSelectionChange={onTempoSelectionChange}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText('100 BPM')).toBeInTheDocument();

    const minusButton = screen.getByRole('button', { name: '-5 BPM' });
    fireEvent.click(minusButton);
    expect(onTempoSelectionChange).toHaveBeenCalledWith({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: 95,
    });

    const plusButton = screen.getByRole('button', { name: '+5 BPM' });
    fireEvent.click(plusButton);
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

  it('locks tempo controls during active practice but keeps metronome interactive', () => {
    const onTempoSelectionChange = vi.fn();
    const onMetronomeEnabledChange = vi.fn();

    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          audioWorkletSupported
          midiSupported
          practiceMode="CONTINUOUS_PLAY"
          practiceModeLocked={true}
          inputSource="MICROPHONE"
          microphoneInputLocked={true}
          midiInputLocked={true}
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          scoreTempoSegments={[{ startBeat: 0, bpm: 100 }]}
          tempoSelection={{ mode: 'CUSTOM_FIXED_BPM', bpm: 100 }}
          tempoLocked={true}
          onTempoSelectionChange={onTempoSelectionChange}
          metronomeEnabled={false}
          onMetronomeEnabledChange={onMetronomeEnabledChange}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByText(/Tempo is locked while practice is active/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Score Tempo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Custom' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '-5 BPM' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+5 BPM' })).toBeDisabled();
    expect(screen.getByLabelText(/BPM Slider/i)).toBeDisabled();

    // Metronome button must remain interactive!
    const metronomeButton = screen.getByRole('button', { name: /Off/i });
    expect(metronomeButton).toBeEnabled();
    fireEvent.click(metronomeButton);
    expect(onMetronomeEnabledChange).toHaveBeenCalledWith(true);
  });
});

