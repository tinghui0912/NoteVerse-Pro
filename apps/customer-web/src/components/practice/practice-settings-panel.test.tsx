// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import messages from '../../../messages/en/practice.json';
import { PracticeSettingsPanel } from './practice-settings-panel';
import { ContinuousPracticeControls, StepPracticeControls } from './practice-controls';
import { evaluatePracticeInputCapabilities, getSelectedInputCapability, getSelectedMicrophoneCapability } from '@/lib/practice/input-capability';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/local-core/artifact';
import type { PracticeRecordingMode } from '@/lib/practice/performance-recorder';

describe('PracticeSettingsPanel', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function recordingPanel(props: {
    practiceMode?: PracticeMode; recordingMode?: PracticeRecordingMode; recordingModeLocked?: boolean;
    recordingStatus?: string; onRecordingModeChange?: (mode: PracticeRecordingMode) => void;
  } = {}) {
    return <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
      <PracticeSettingsPanel practiceMode="CONTINUOUS_PLAY" inputSource="MIDI"
        practiceModeLocked={false} microphoneInputLocked={false} midiInputLocked={false}
        microphoneCapability={{ supported: true, status: 'AVAILABLE' }}
        midiCapability={{ supported: true, status: 'AVAILABLE' }}
        onPracticeModeChange={vi.fn()} onInputSourceChange={vi.fn()}
        onRecordingModeChange={vi.fn()} {...props} />
    </NextIntlClientProvider>;
  }

  it('hides recording controls in STEP mode', () => {
    render(recordingPanel({ practiceMode: 'STEP_BY_STEP' }));
    expect(screen.queryByRole('heading', { name: 'Recording' })).toBeNull();
    for (const label of ['No recording', 'Record audio', 'Record video']) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${label}`) })).toBeNull();
    }
  });

  it.each(['OFF', 'AUDIO', 'VIDEO'] as const)('renders Continuous recording controls with %s selected', recordingMode => {
    render(recordingPanel({ recordingMode }));
    expect(screen.getByRole('heading', { name: 'Recording' })).toBeVisible();
    for (const [mode, label] of [['OFF', 'No recording'], ['AUDIO', 'Record audio'], ['VIDEO', 'Record video']]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
        .toHaveAttribute('aria-pressed', String(mode === recordingMode));
    }
  });

  it('delegates VIDEO selection exactly once', () => {
    const change = vi.fn();
    render(recordingPanel({ onRecordingModeChange: change }));
    fireEvent.click(screen.getByRole('button', { name: /^Record video/ }));
    expect(change).toHaveBeenCalledExactlyOnceWith('VIDEO');
  });

  it('locks all recording options independently from mode and input controls', () => {
    render(recordingPanel({ recordingModeLocked: true }));
    for (const label of ['No recording', 'Record audio', 'Record video']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeDisabled();
    }
    for (const name of [/^step-by-step/i, /^continuous play/i, /^microphone/i, /midi keyboard/i]) {
      expect(screen.getByRole('button', { name })).toBeEnabled();
    }
  });

  it('shows the supplied camera status in the VIDEO option instead of its default description', () => {
    render(recordingPanel({ recordingStatus: messages.settingCameraReady }));
    expect(screen.getByRole('button', { name: /^Record video/ })).toHaveTextContent(messages.settingCameraReady);
    expect(screen.queryByText(messages.settingCameraDesc)).toBeNull();
  });

  it('enables default STEP and explicit Continuous microphone Start, and locks mode/input while active', () => {
    vi.stubGlobal('AudioContext', class MockAudioContext {});
    vi.stubGlobal('AudioWorkletNode', class MockAudioWorkletNode {});
    vi.stubGlobal('Worker', class MockWorker {});
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn() } });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() }, storage: { getDirectory: vi.fn() },
      gpu: { requestAdapter: vi.fn() }, requestMIDIAccess: vi.fn() });
    const start = vi.fn();
    function PracticeAvailability() {
      const [mode, setMode] = useState<PracticeMode>('STEP_BY_STEP');
      const [input, setInput] = useState<PracticeInputSource>('MICROPHONE');
      const [active, setActive] = useState(false);
      const capabilities = evaluatePracticeInputCapabilities();
      const controls = { isLoading: false, isPreparingSession: false, canPrepareSession: true,
        selectedInputCapability: getSelectedInputCapability(input, capabilities, mode),
        rangeSelectionActive: false, canSelectRange: !active, onStart: () => { start(); setActive(true); },
        onFinish: vi.fn(), onOpenSettings: vi.fn(), onToggleRangeSelection: vi.fn() };
      return <>
        <PracticeSettingsPanel practiceMode={mode} practiceModeLocked={active} inputSource={input}
          microphoneCapability={getSelectedMicrophoneCapability(capabilities, mode)} midiCapability={capabilities.midi}
          microphoneInputLocked={active} midiInputLocked={active} onPracticeModeChange={setMode} onInputSourceChange={setInput} />
        {mode === 'CONTINUOUS_PLAY'
          ? <ContinuousPracticeControls {...controls} lifecycle={active ? 'ACTIVE' : 'READY'} onPause={vi.fn()} onResume={vi.fn()} />
          : <StepPracticeControls {...controls} lifecycle="IDLE" />}
      </>;
    }
    render(<NextIntlClientProvider locale="en" messages={{ practice: messages }}><PracticeAvailability /></NextIntlClientProvider>);
    expect(screen.getByRole('button', { name: /^step-by-step/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^start$/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /midi keyboard/i }));
    expect(screen.getByRole('button', { name: /^start$/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^microphone/i }));
    expect(screen.getByRole('button', { name: /^start$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^step-by-step/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^continuous play/i }));
    expect(screen.getByRole('button', { name: /^start$/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /^start$/i }));
    expect(start).toHaveBeenCalledOnce();
    for (const name of [/^step-by-step/i, /^continuous play/i, /^microphone/i, /midi keyboard/i]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
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

    const micBtn = screen.getByRole('button', { name: /^microphone/i });
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

    expect(screen.getByRole('button', { name: /^microphone/i })).toBeEnabled();
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
    expect(screen.getByRole('button', { name: /^microphone/i })).toBeDisabled();
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

  it('displays the unsupported microphone runtime status', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          microphoneCapability={{
            supported: false,
            status: 'BROWSER_UNSUPPORTED',
            reason: 'BROWSER_UNSUPPORTED',
          }}
          midiCapability={{
            supported: true,
            status: 'AVAILABLE',
          }}
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

    expect(
      screen.getByText('Unavailable in this browser')
    ).toBeVisible();
  });

  it('disables MIDI button when midiCapability is BROWSER_UNSUPPORTED', () => {
    render(
      <NextIntlClientProvider locale="en" messages={{ practice: messages }}>
        <PracticeSettingsPanel
          microphoneCapability={{
            supported: true,
            status: 'AVAILABLE',
          }}
          midiCapability={{
            supported: false,
            status: 'BROWSER_UNSUPPORTED',
            reason: 'BROWSER_UNSUPPORTED',
          }}
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

    expect(screen.getByRole('button', { name: /midi keyboard/i })).toBeDisabled();
    expect(screen.getByText('Unavailable in this browser')).toBeVisible();
  });
});
