// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { VerovioScoreViewer } from './verovio-score-viewer';
import type { VerovioScoreAdapter } from '@/lib/score/verovio';

function mockAdapter(svg: string): VerovioScoreAdapter {
  return {
    loadMusicXml: vi.fn().mockResolvedValue(undefined),
    renderAllPages: vi.fn(() => [{ pageNumber: 1, svg }]),
    dispose: vi.fn(),
  } as unknown as VerovioScoreAdapter;
}

describe('VerovioScoreViewer', () => {
  it('prefers the rendered note data-id when clicked children have graphical ids', async () => {
    const onRenderNoteClick = vi.fn();
    render(
      <VerovioScoreViewer
        xmlContent="<score-partwise />"
        adapterFactory={() =>
          mockAdapter(
            '<svg><g data-id="note-semantic-id"><path id="notehead-graphic-id" data-testid="notehead" /></g></svg>'
          )
        }
        loadingContent={<span>Loading</span>}
        emptyContent={<span>Empty</span>}
        renderError={(message) => <span>{message}</span>}
        onRenderNoteClick={onRenderNoteClick}
      />
    );

    await waitFor(() => expect(screen.getByTestId('notehead')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notehead'));

    expect(onRenderNoteClick).toHaveBeenCalledWith('note-semantic-id');
  });

  it('ignores graphical ids that are not rendered note data ids', async () => {
    const onRenderNoteClick = vi.fn();
    render(
      <VerovioScoreViewer
        xmlContent="<score-partwise />"
        adapterFactory={() =>
          mockAdapter('<svg><path id="notehead-graphic-id" data-testid="notehead" /></svg>')
        }
        loadingContent={<span>Loading</span>}
        emptyContent={<span>Empty</span>}
        renderError={(message) => <span>{message}</span>}
        onRenderNoteClick={onRenderNoteClick}
      />
    );

    await waitFor(() => expect(screen.getByTestId('notehead')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('notehead'));

    expect(onRenderNoteClick).not.toHaveBeenCalled();
  });
});
