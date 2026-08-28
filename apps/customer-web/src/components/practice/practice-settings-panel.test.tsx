// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeSettingsPanel } from './practice-settings-panel';

describe('PracticeSettingsPanel', () => {
  it('keeps microphone selectable while MIDI is locked for continuous performance', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          connectionStatus="disconnected"
          hasMicPermission={null}
          audioWorkletSupported
          midiSupported
          hasMidiPermission={null}
          hasMidiInput
          preset="CONTINUOUS_PLAY"
          presetLocked={false}
          inputSource="MICROPHONE"
          microphoneInputLocked={false}
          midiInputLocked
          showNextNoteHint
          onPresetChange={vi.fn()}
          onInputSourceChange={vi.fn()}
          onShowNextNoteHintChange={vi.fn()}
        />
      </NextIntlClientProvider>
    );

    expect(screen.getByRole('button', { name: /microphone/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /midi keyboard/i })).toBeDisabled();
  });
});
