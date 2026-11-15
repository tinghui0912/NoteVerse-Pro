// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useMetadataEditor } from './use-metadata-editor';
import { MusicXMLParser } from '@/lib/musicxml/parser';

let document: XMLDocument;
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./use-xml-updater', () => ({ useXmlUpdater: () => ({ updateMusicXML: (update: (xml: XMLDocument) => void) => update(document) }) }));

it('edits notation work title and its visible title credit together', () => {
  document = new DOMParser().parseFromString('<score-partwise><part id="P1"><measure number="1"/></part></score-partwise>', 'text/xml');
  const { result } = renderHook(useMetadataEditor);
  act(() => result.current.updateNotationTitle('Moonlight — edited notation'));
  expect(document.querySelector('work > work-title')?.textContent).toBe('Moonlight — edited notation');
  expect(document.querySelector('credit > credit-words')?.textContent).toBe('Moonlight — edited notation');
  expect(new MusicXMLParser(new XMLSerializer().serializeToString(document)).parse().notationTitle).toBe('Moonlight — edited notation');
});

it.each([true, false])('edits literal metronome notation without creating a conflicting quarter-rate sound (visible=%s)', visible => {
  document = new DOMParser().parseFromString('<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><sound tempo="120"/><note><rest/><duration>4</duration></note></measure></part></score-partwise>', 'text/xml');
  const { result } = renderHook(useMetadataEditor);
  act(() => result.current.updateTempo('60', { beatUnit: 'half', dots: 1, showMark: visible }));
  const parsed = new MusicXMLParser(new XMLSerializer().serializeToString(document)).parse();
  expect(parsed.tempoNotation).toEqual({ perMinute: '60', beatUnit: 'half', dots: 1, visible });
  expect(document.querySelector('sound[tempo]')).toBeNull();
});
