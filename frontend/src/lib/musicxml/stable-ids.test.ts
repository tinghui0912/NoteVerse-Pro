// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { ensureStableMusicXmlIds, prepareMusicXmlIdsForVerovio, stripAppOwnedMusicXmlIdsString } from './stable-ids';

describe('ensureStableMusicXmlIds', () => {
  it('preserves a legal source id', () => {
    const xmlDoc = new DOMParser().parseFromString(
      '<score-partwise><part><measure><note id="legacy"><duration>1</duration></note></measure></part></score-partwise>',
      'application/xml',
    );

    expect(ensureStableMusicXmlIds(xmlDoc)).toBe(false);
    const note = xmlDoc.querySelector('note')!;
    expect(note.getAttribute('id')).toBe('legacy');
    expect(note.hasAttribute('id')).toBe(true);
  });
});

describe('stripAppOwnedMusicXmlIdsString', () => {
  it('removes app ids while preserving source ids', () => {
    const source = '<score-partwise><part-list/><part id="P1"><measure><note/><note id="nv-source-note"/><forward id="legacy"/></measure></part></score-partwise>';
    const workingDoc = new DOMParser().parseFromString(source, 'application/xml');
    ensureStableMusicXmlIds(workingDoc);
    const result = stripAppOwnedMusicXmlIdsString(new XMLSerializer().serializeToString(workingDoc));
    const doc = new DOMParser().parseFromString(result, 'application/xml');
    const elements = doc.querySelectorAll('note, forward');
    expect(elements[0].getAttribute('id')).toBeNull();
    expect(elements[1].getAttribute('id')).toBe('nv-source-note');
    expect(elements[2].getAttribute('id')).toBe('legacy');
  });
});

describe('prepareMusicXmlIdsForVerovio', () => {
  it('adds an ordinary id to the render copy', () => {
    const source = '<score-partwise><part-list/><part id="P1"><measure><note><pitch/></note></measure></part></score-partwise>';
    const rendered = prepareMusicXmlIdsForVerovio(source);
    const note = new DOMParser().parseFromString(rendered, 'application/xml').querySelector('note');
    expect(note?.getAttribute('id')).toMatch(/^nv-/);
    expect(note?.hasAttribute('data-nv-generated-id')).toBe(false);
    expect(new DOMParser().parseFromString(source, 'application/xml').querySelector('note')?.hasAttribute('id')).toBe(false);
  });
});
