// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { VerovioScoreViewer } from '@/components/score-preview/verovio-score-viewer';
import {
  sanitizeMusicXmlForVerovio,
  VerovioScoreAdapter,
  type VerovioToolkitLike,
} from '@/lib/score/verovio';

class FakeToolkit implements VerovioToolkitLike {
  loadedXml = '';
  options: Record<string, unknown> = {};

  constructor(private readonly pageCount = 2) {}

  setOptions(options: Record<string, unknown>) {
    this.options = options;
    return true;
  }

  loadData(data: string) {
    this.loadedXml = data;
    return true;
  }

  renderToSVG(pageNumber = 1) {
    return `<svg aria-label="score-page-${pageNumber}"><g id="note-${pageNumber}" /></svg>`;
  }

  renderToMIDI() {
    return '';
  }

  renderToTimemap() {
    return [];
  }

  getPageCount() {
    return this.pageCount;
  }

  getPageWithElement(xmlId: string) {
    return xmlId === 'note-2' ? 2 : 1;
  }

  getElementsAtTime(milliseconds: number) {
    return { milliseconds, notes: ['note-1'] };
  }

  redoLayout() {}
}

const fixtureXml = readFileSync(
  resolve(process.cwd(), 'tests/fixtures/musicxml/multi-page.musicxml'),
  'utf8'
);

describe('VerovioScoreAdapter', () => {
  it('owns a separate toolkit instance for every adapter', async () => {
    const toolkits: FakeToolkit[] = [];
    const factory = async () => {
      const toolkit = new FakeToolkit();
      toolkits.push(toolkit);
      return toolkit;
    };
    const first = new VerovioScoreAdapter(factory);
    const second = new VerovioScoreAdapter(factory);

    await Promise.all([first.loadMusicXml(fixtureXml), second.loadMusicXml(fixtureXml)]);

    expect(toolkits).toHaveLength(2);
    expect(toolkits[0]).not.toBe(toolkits[1]);
    expect(first.renderAllPages()).toHaveLength(2);
    expect(second.getElementsAtTime(250)).toEqual({
      milliseconds: 250,
      notes: ['note-1'],
    });
  });

  it('removes invalid chord state before Verovio receives the XML', () => {
    const sanitized = sanitizeMusicXmlForVerovio(`
      <score-partwise><part><measure>
        <note><chord/><rest/><beam>begin</beam><voice>1</voice></note>
      </measure></part></score-partwise>
    `);

    expect(sanitized).not.toContain('<chord');
    expect(sanitized).not.toContain('<beam');
    expect(sanitized).toContain('<rest');
  });

  it('adds ordinary ids before Verovio receives the XML so SVG hit testing can map notes', async () => {
    const toolkit = new FakeToolkit(1);
    const adapter = new VerovioScoreAdapter(async () => toolkit);

    await adapter.loadMusicXml(`
      <score-partwise><part><measure number="1">
        <note>
          <pitch><step>C</step><octave>4</octave></pitch>
          <duration>1</duration>
          <voice>1</voice>
          <type>quarter</type>
          <staff>1</staff>
        </note>
      </measure></part></score-partwise>
    `);

    expect(toolkit.loadedXml).toContain('id="nv-');
  });

  it('uses editor Verovio layout options so header credits and footer rights can render together', async () => {
    const toolkit = new FakeToolkit(1);
    const adapter = new VerovioScoreAdapter(async () => toolkit);

    await adapter.loadMusicXml('<score-partwise />');

    expect(toolkit.options).toMatchObject({
      inputFrom: 'xml',
      pageHeight: 2970,
      pageWidth: 2100,
      scale: 40,
      header: 'auto',
      footer: 'always',
      adjustPageHeight: true,
      justifyVertically: false,
      pageMarginTop: 140,
      pageMarginBottom: 40,
      usePgFooterForAll: true,
      svgHtml5: true,
      breaks: 'encoded',
    });
  });
});

describe('VerovioScoreViewer', () => {
  it('renders a real MusicXML fixture as multiple score pages', async () => {
    const adapterFactory = () => new VerovioScoreAdapter(async () => new FakeToolkit(2));

    render(
      <VerovioScoreViewer
        xmlContent={fixtureXml}
        adapterFactory={adapterFactory}
        loadingContent={<p>Loading score</p>}
        emptyContent={<p>No score</p>}
        errorMessage="Unable to render score"
        renderError={(message) => <p>{message}</p>}
      />
    );

    expect(screen.getByText('Loading score')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByLabelText(/score-page-/)).toHaveLength(2));
    expect(document.querySelector('[data-score-page="1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-score-page="2"]')).toBeInTheDocument();
  });

  it('renders the caller-owned empty state without loading a toolkit', () => {
    render(
      <VerovioScoreViewer
        xmlContent={null}
        loadingContent={<p>Loading score</p>}
        emptyContent={<p>No score</p>}
        errorMessage="Unable to render score"
        renderError={(message) => <p>{message}</p>}
      />
    );

    expect(screen.getByText('No score')).toBeInTheDocument();
    expect(screen.queryByText('Loading score')).not.toBeInTheDocument();
  });

  it('renders the caller-owned error state when Verovio rejects the score', async () => {
    const toolkit = new FakeToolkit();
    toolkit.loadData = () => false;

    render(
      <VerovioScoreViewer
        xmlContent={fixtureXml}
        adapterFactory={() => new VerovioScoreAdapter(async () => toolkit)}
        loadingContent={<p>Loading score</p>}
        emptyContent={<p>No score</p>}
        errorMessage="Unable to render score"
        renderError={(message) => <p role="alert">Could not render: {message}</p>}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not render: Unable to render score'
    );
  });
});
