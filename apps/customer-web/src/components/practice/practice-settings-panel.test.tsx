// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeSettingsPanel } from './practice-settings-panel';

describe('PracticeSettingsPanel', () => {
  it('keeps microphone and MIDI selectable before step-by-step practice starts', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          connectionStatus="disconnected"
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
          showNextNoteHint
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          onShowNextNoteHintChange={vi.fn()}
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
          connectionStatus="disconnected"
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
          showNextNoteHint
          onPracticeModeChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          onShowNextNoteHintChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /microphone/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /midi keyboard/i })).toBeEnabled();
    expect(screen.queryByRole('switch', { name: /show the next note/i })).not.toBeInTheDocument();
  });
});
