// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeSettingsPanel } from './practice-settings-panel';

describe('PracticeSettingsPanel', () => {
  it('keeps microphone and MIDI selectable before step-by-step practice starts', () => {
    const onInputSourceChange = vi.fn();
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
          onInputSourceChange={onInputSourceChange}
        />
      </NextIntlClientProvider>
    );

    const micBtn = screen.getByRole('button', { name: /microphone/i });
    const midiBtn = screen.getByRole('button', { name: /midi keyboard/i });
    expect(micBtn).toBeEnabled();
    expect(midiBtn).toBeEnabled();

    fireEvent.click(midiBtn);
    expect(onInputSourceChange).toHaveBeenCalledWith('MIDI');
  });

  it('keeps microphone and MIDI selectable before continuous play starts', () => {
    const onPracticeModeChange = vi.fn();
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
          onPracticeModeChange={onPracticeModeChange}
          onInputSourceChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /microphone/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /midi keyboard/i })).toBeEnabled();

    const stepBtn = screen.getByRole('button', { name: /step-by-step/i });
    fireEvent.click(stepBtn);
    expect(onPracticeModeChange).toHaveBeenCalledWith('STEP_BY_STEP');
  });

  it('locks practice mode and input source during active practice', () => {
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
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /step-by-step/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /continuous play/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /microphone/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /midi keyboard/i })).toBeDisabled();
  });

  it('does NOT render duplicate tempo or metronome controls in settings panel', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          audioWorkletSupported
          midiSupported
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

    expect(screen.queryByText(/Tempo & Metronome/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Score Tempo' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Custom' })).toBeNull();
    expect(screen.queryByLabelText(/BPM Slider/i)).toBeNull();
    expect(screen.queryByText(/^Metronome$/i)).toBeNull();
  });
});
