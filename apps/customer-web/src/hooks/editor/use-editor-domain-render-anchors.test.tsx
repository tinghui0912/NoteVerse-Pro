// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { ScoreDataProvider, useScoreData } from '@/contexts/score-data-context';
import { useEditorDomainRenderAnchors } from './use-editor-domain-render-anchors';

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

describe('useEditorDomainRenderAnchors', () => {
  it('derives source render anchors from current XML and resolves domain anchors', () => {
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      anchors: useEditorDomainRenderAnchors(),
    }), { wrapper });

    expect(result.current.anchors.anchors).toEqual([]);
    expect(result.current.anchors.resolveAnchor('note-1')).toBeNull();

    act(() => {
      result.current.scoreData.setCurrentXml(scoreXml(`
        <note id="note-1">
          <pitch><step>C</step><octave>4</octave></pitch>
          <duration>4</duration>
          <voice>1</voice>
          <type>quarter</type>
        </note>
      `));
    });

    expect(result.current.anchors.error).toBeNull();
    expect(result.current.anchors.anchors).not.toEqual([]);
    expect(result.current.anchors.resolveAnchor('note-1')).toMatchObject({
      kind: 'noteAtom',
    });
  });

  it('exposes domain import errors without manufacturing anchors', () => {
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      anchors: useEditorDomainRenderAnchors(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml('<score-partwise>');
    });

    expect(result.current.anchors.anchors).toEqual([]);
    expect(result.current.anchors.error?.message).toBe('Failed to parse MusicXML.');
  });
});
