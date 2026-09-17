// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  createUniqueMusicXmlId,
  ensureGenericRenderMusicXmlIds,
  prepareMusicXmlIdsForGenericVerovioRender,
  stripAppOwnedGenericRenderMusicXmlIdsString,
} from './generic-render-ids';

describe('createUniqueMusicXmlId', () => {
  it('sanitizes the base id and adds a deterministic collision suffix', () => {
    const usedIds = new Set(['nv-note-chord-2', 'nv-note-chord-2-2']);

    expect(createUniqueMusicXmlId(' 9 note chord 2 ', usedIds)).toBe('nv-9-note-chord-2');
    expect(createUniqueMusicXmlId('nv-note-chord-2', usedIds)).toBe('nv-note-chord-2-3');
  });
});

describe('ensureGenericRenderMusicXmlIds', () => {
  it('preserves a legal source id', () => {
    const xmlDoc = new DOMParser().parseFromString(
      '<score-partwise><part><measure><note id="legacy"><duration>1</duration></note></measure></part></score-partwise>',
      'application/xml',
    );

    expect(ensureGenericRenderMusicXmlIds(xmlDoc)).toBe(false);
    const note = xmlDoc.querySelector('note')!;
    expect(note.getAttribute('id')).toBe('legacy');
    expect(note.hasAttribute('id')).toBe(true);
  });

  it('generates deterministic structural ids for missing ids', () => {
    const xmlDoc = new DOMParser().parseFromString(
      '<score-partwise><part-list/><part id="P1"><measure number="A"><note/><note/><forward/></measure><measure number="B"><note/></measure></part><part id="P2"><measure number="A"><note/></measure></part></score-partwise>',
      'application/xml',
    );

    expect(ensureGenericRenderMusicXmlIds(xmlDoc)).toBe(true);
    expect(
      Array.from(xmlDoc.querySelectorAll('note, forward')).map((element) =>
        element.getAttribute('id')
      )
    ).toEqual([
      'nv-p1-m1-note1',
      'nv-p1-m1-note2',
      'nv-p1-m1-forward3',
      'nv-p1-m2-note1',
      'nv-p2-m1-note1',
    ]);
  });

  it('avoids collisions between preserved ids and generated generic render ids', () => {
    const xmlDoc = new DOMParser().parseFromString(
      '<score-partwise><part id="P1"><measure><note id="nv-p1-m1-note2"/><note/></measure></part></score-partwise>',
      'application/xml',
    );

    expect(ensureGenericRenderMusicXmlIds(xmlDoc)).toBe(true);
    expect(
      Array.from(xmlDoc.querySelectorAll('note')).map((element) => element.getAttribute('id'))
    ).toEqual(['nv-p1-m1-note2', 'nv-p1-m1-note2-2']);
  });
});

describe('stripAppOwnedGenericRenderMusicXmlIdsString', () => {
  it('removes app ids while preserving source ids', () => {
    const source = '<score-partwise><part-list/><part id="P1"><measure><note/><note id="nv-source-note"/><forward id="legacy"/></measure></part></score-partwise>';
    const workingDoc = new DOMParser().parseFromString(source, 'application/xml');
    ensureGenericRenderMusicXmlIds(workingDoc);
    const result = stripAppOwnedGenericRenderMusicXmlIdsString(new XMLSerializer().serializeToString(workingDoc));
    const doc = new DOMParser().parseFromString(result, 'application/xml');
    const elements = doc.querySelectorAll('note, forward');
    expect(elements[0].getAttribute('id')).toBeNull();
    expect(elements[1].getAttribute('id')).toBe('nv-source-note');
    expect(elements[2].getAttribute('id')).toBe('legacy');
  });
});

describe('prepareMusicXmlIdsForGenericVerovioRender', () => {
  it('adds an ordinary id to the render copy', () => {
    const source = '<score-partwise><part-list/><part id="P1"><measure><note><pitch/></note></measure></part></score-partwise>';
    const rendered = prepareMusicXmlIdsForGenericVerovioRender(source);
    const note = new DOMParser().parseFromString(rendered, 'application/xml').querySelector('note');
    expect(note?.getAttribute('id')).toBe('nv-p1-m1-note1');
    expect(note?.hasAttribute('data-nv-generated-id')).toBe(false);
    expect(new DOMParser().parseFromString(source, 'application/xml').querySelector('note')?.hasAttribute('id')).toBe(false);
  });
});
