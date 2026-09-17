// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import commonMessages from '../../../messages/en/common.json';
import editorMessages from '../../../messages/en/editor.json';
import { EditorStateProvider, useEditorState } from '@/contexts/editor-state-context';
import { EditorSidebar } from './editor-sidebar';

vi.mock('./voice-layer', () => ({
  VoiceLayer: () => null,
}));

beforeAll(() => {
  window.matchMedia ??= vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  HTMLElement.prototype.hasPointerCapture ??= vi.fn(() => false);
  HTMLElement.prototype.setPointerCapture ??= vi.fn();
  HTMLElement.prototype.releasePointerCapture ??= vi.fn();
  HTMLElement.prototype.scrollIntoView ??= vi.fn();
});

function StateProbe() {
  const { addModeGridResolution, addModeInput, addModeInputDuration } = useEditorState();

  return (
    <>
      <output data-testid="add-mode-input-kind">
        {addModeInput.kind}
      </output>
      <output data-testid="add-mode-duration">
        {JSON.stringify(addModeInputDuration.rhythm.timelineDuration)}
      </output>
      <output data-testid="add-mode-grid">
        {JSON.stringify(addModeGridResolution.step)}
      </output>
    </>
  );
}

function renderSidebar(editorMode: 'select' | 'add') {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common: commonMessages, editor: editorMessages }}>
      <EditorStateProvider>
        <EditorSidebar
          editorMode={editorMode}
          onToolSelect={vi.fn()}
        />
        <StateProbe />
      </EditorStateProvider>
    </NextIntlClientProvider>
  );
}

describe('EditorSidebar add-mode input controls', () => {
  it('shows note-entry duration tools only while add mode is active', () => {
    const { rerender } = render(
      <NextIntlClientProvider locale="en" messages={{ common: commonMessages, editor: editorMessages }}>
        <EditorStateProvider>
          <EditorSidebar editorMode="select" onToolSelect={vi.fn()} />
        </EditorStateProvider>
      </NextIntlClientProvider>
    );

    expect(screen.queryByText('Note Entry Duration')).not.toBeInTheDocument();
    expect(screen.queryByText('Input Type')).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ common: commonMessages, editor: editorMessages }}>
        <EditorStateProvider>
          <EditorSidebar editorMode="add" onToolSelect={vi.fn()} />
        </EditorStateProvider>
      </NextIntlClientProvider>
    );

    expect(screen.getByText('Input Type')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rest Input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Note Input' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Note Input' })).toHaveTextContent('C4');
    expect(screen.getByText('Note Entry Duration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Whole Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Half Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Quarter Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eighth Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '16th Note' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '32nd Note' })).toBeInTheDocument();
    expect(screen.getByText('Placement Grid')).toBeInTheDocument();
  });

  it('updates add-mode input type in editor state', async () => {
    const user = userEvent.setup();
    renderSidebar('add');

    expect(screen.getByTestId('add-mode-input-kind')).toHaveTextContent('rest');

    await user.click(screen.getByRole('button', { name: 'Note Input' }));

    expect(screen.getByTestId('add-mode-input-kind')).toHaveTextContent('pitched');

    await user.click(screen.getByRole('button', { name: 'Rest Input' }));

    expect(screen.getByTestId('add-mode-input-kind')).toHaveTextContent('rest');
  });

  it('updates add-mode note-entry duration in editor state', async () => {
    const user = userEvent.setup();
    renderSidebar('add');

    expect(screen.getByTestId('add-mode-duration')).toHaveTextContent('{"numerator":1,"denominator":1}');

    await user.click(screen.getByRole('button', { name: 'Half Note' }));

    expect(screen.getByTestId('add-mode-duration')).toHaveTextContent('{"numerator":2,"denominator":1}');

    await user.click(screen.getByRole('button', { name: '32nd Note' }));

    expect(screen.getByTestId('add-mode-duration')).toHaveTextContent('{"numerator":1,"denominator":8}');
  });

  it('updates add-mode placement grid without changing note-entry duration', async () => {
    const user = userEvent.setup();
    renderSidebar('add');

    expect(screen.getByTestId('add-mode-duration')).toHaveTextContent('{"numerator":1,"denominator":1}');
    expect(screen.getByTestId('add-mode-grid')).toHaveTextContent('{"numerator":1,"denominator":1}');

    const gridTrigger = screen.getAllByText('Quarter Grid')
      .map((node) => node.closest('button'))
      .find((button): button is HTMLButtonElement => Boolean(button));
    expect(gridTrigger).toBeTruthy();
    if (!gridTrigger) return;

    await user.click(gridTrigger);
    await user.click(await screen.findByRole('option', { name: '16th Grid' }));

    expect(screen.getByTestId('add-mode-duration')).toHaveTextContent('{"numerator":1,"denominator":1}');
    expect(screen.getByTestId('add-mode-grid')).toHaveTextContent('{"numerator":1,"denominator":4}');
  });
});
