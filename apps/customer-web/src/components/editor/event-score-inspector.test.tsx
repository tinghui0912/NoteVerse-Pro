// @vitest-environment jsdom
import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { EditorSessionProvider, useEditorSession } from '@/contexts/editor-session-context';
import { effectiveMeasureContext } from '@/lib/editor-domain';
import { DEFAULT_SCORE_TEMPO_BPM } from '@/lib/score/tempo-policy';
import editorMessages from '../../../messages/en/editor.json';
import scoreMessages from '../../../messages/en/score.json';
import { editorXml, note } from '../../../tests/fixtures/editor';
import { ScoreInspectorPanel } from './event-score-inspector';

beforeAll(() => {
  globalThis.ResizeObserver ??= class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => undefined;
  HTMLElement.prototype.releasePointerCapture ??= () => undefined;
  HTMLElement.prototype.scrollIntoView ??= () => undefined;
});

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={{ editor: editorMessages, score: scoreMessages }}>
      <EditorSessionProvider>
        {children}
        <ScoreInspectorPanel onClose={() => undefined} />
      </EditorSessionProvider>
    </NextIntlClientProvider>
  );
}

function loadedInspector() {
  const hook = renderHook(useEditorSession, { wrapper });
  act(() => {
    hook.result.current.loadMusicXml(editorXml(note(), '<divisions>8</divisions>'));
  });
  return hook;
}

describe('Score Inspector musical facts and input suggestions', () => {
  it('shows unset key and meter and a distinct tempo suggestion without creating musical facts', async () => {
    const user = userEvent.setup();
    const { result } = loadedInspector();
    const before = result.current.document!;
    expect(screen.getByRole('button', { name: 'Key Signature' })).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Time Signature' })).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Tempo' })).toHaveTextContent(
      `No tempo mark · ${DEFAULT_SCORE_TEMPO_BPM} suggested`,
    );

    await user.click(screen.getByRole('button', { name: 'Time Signature' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Tempo' }));
    await user.keyboard('{Escape}');

    expect(result.current.document).toBe(before);
    expect(effectiveMeasureContext(before, before.measures[0].id)).toMatchObject({
      key: null,
      meter: null,
    });
    expect(before.metadata.tempoNotation).toBeNull();
    expect(result.current.canUndo).toBe(false);
    expect(screen.getByRole('button', { name: 'Time Signature' })).toHaveTextContent('—');
  });

  it('creates an explicit C key only when the user selects it', async () => {
    const user = userEvent.setup();
    const { result } = loadedInspector();
    await user.click(screen.getByRole('button', { name: 'Key Signature' }));
    await user.click(screen.getByRole('button', { name: 'C' }));
    const document = result.current.document!;
    expect(effectiveMeasureContext(document, document.measures[0].id).key).toEqual({ fifths: 0 });
    expect(screen.getByRole('button', { name: 'Key Signature' })).toHaveTextContent('C');
    expect(document.metadata.tempoNotation).toBeNull();
  });

  it('creates an explicit common meter only when the user selects it', async () => {
    const user = userEvent.setup();
    const { result } = loadedInspector();
    await user.click(screen.getByRole('button', { name: 'Time Signature' }));
    await user.click(screen.getByRole('button', { name: '4/4' }));
    const document = result.current.document!;
    expect(effectiveMeasureContext(document, document.measures[0].id).meter).toEqual({
      beats: 4,
      beatType: 4,
    });
    expect(screen.getByRole('button', { name: 'Time Signature' })).toHaveTextContent('4/4');
    expect(document.metadata.tempoNotation).toBeNull();
  });

  it('distinguishes a committed tempo from the same suggested BPM', async () => {
    const user = userEvent.setup();
    const { result } = loadedInspector();
    await user.click(screen.getByRole('button', { name: 'Tempo' }));
    await user.click(screen.getByRole('button', { name: '1/4' }));
    expect(result.current.document!.metadata.tempoNotation).toEqual({
      perMinute: DEFAULT_SCORE_TEMPO_BPM,
      beatUnit: 'quarter',
      dots: 0,
      visible: false,
    });
    const trigger = screen.getByRole('button', { name: 'Tempo' });
    expect(trigger).toHaveTextContent(`1/4 = ${DEFAULT_SCORE_TEMPO_BPM}`);
    expect(trigger).not.toHaveTextContent('suggested');
  });
});
