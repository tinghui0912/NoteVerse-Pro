// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { PracticeVerovioAdapter } from './verovio-adapter';
import type { Mock } from 'vitest';
import type { VerovioToolkitLike } from '@/lib/score/verovio';

function mockToolkit() {
  return {
    setOptions: vi.fn(),
    loadData: vi.fn(() => true),
    renderToSVG: vi.fn(() => '<svg />'),
    renderToMIDI: vi.fn(() => ''),
    renderToTimemap: vi.fn(() => []),
    getPageCount: vi.fn(() => 1),
    getPageWithElement: vi.fn(() => 1),
    redoLayout: vi.fn(),
  } satisfies VerovioToolkitLike;
}

describe('PracticeVerovioAdapter', () => {
  it('does not generate frontend ids for backend-prepared practice MusicXML', async () => {
    const toolkit = mockToolkit();
    const adapter = new PracticeVerovioAdapter(async () => toolkit);

    await adapter.loadMusicXml('<score-partwise><part><measure><note /></measure></part></score-partwise>');

    const loadData = toolkit.loadData as Mock<(data: string) => boolean>;
    expect(loadData).toHaveBeenCalledOnce();
    expect(loadData.mock.calls[0]?.[0]).not.toContain('nv-p1-m1-note1');
  });
});
