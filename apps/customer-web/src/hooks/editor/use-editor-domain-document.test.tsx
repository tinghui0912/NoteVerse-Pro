// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ScoreDataProvider, useScoreData } from '@/contexts/score-data-context';
import {
  deriveEditorDomainDocument,
  useEditorDomainDocument,
} from './use-editor-domain-document';

function scoreXml(measureContent: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list>
    <score-part id="P1">
      <part-name>Piano</part-name>
    </score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <time>
          <beats>4</beats>
          <beat-type>4</beat-type>
        </time>
      </attributes>
      ${measureContent}
    </measure>
  </part>
</score-partwise>`;
}

function wrapper({ children }: { children: ReactNode }) {
  return <ScoreDataProvider>{children}</ScoreDataProvider>;
}

describe('useEditorDomainDocument', () => {
  it('derives a read-only editor-domain document from current XML', () => {
    const xml = scoreXml(`
      <note id="n1">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <forward><duration>4</duration><voice>1</voice></forward>
    `);

    const state = deriveEditorDomainDocument(xml);

    expect(state.error).toBeNull();
    expect(state.document?.events).toHaveLength(1);
    expect(state.document?.events[0]).toMatchObject({
      kind: 'pitched',
      source: { musicXmlElementIds: ['n1'] },
    });
    expect(state.gaps).toHaveLength(1);
  });

  it('exposes invalid source as an explicit adapter error', () => {
    const state = deriveEditorDomainDocument('<score-partwise>');

    expect(state.document).toBeNull();
    expect(state.gaps).toEqual([]);
    expect(state.error?.message).toBe('A valid score-partwise MusicXML document is required.');
  });

  it('updates the derived document when current XML changes', () => {
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorDomain: useEditorDomainDocument(),
    }), { wrapper });

    expect(result.current.editorDomain.document).toBeNull();
    expect(result.current.editorDomain.error).toBeNull();

    act(() => {
      result.current.scoreData.setCurrentXml(scoreXml(`
        <note id="n1">
          <pitch><step>D</step><octave>4</octave></pitch>
          <duration>4</duration>
          <voice>1</voice>
          <type>quarter</type>
        </note>
      `));
    });

    expect(result.current.editorDomain.error).toBeNull();
    expect(result.current.editorDomain.document?.events).toHaveLength(1);
    expect(result.current.editorDomain.document?.events[0]).toMatchObject({
      kind: 'pitched',
      source: { musicXmlElementIds: ['n1'] },
    });
  });
});
