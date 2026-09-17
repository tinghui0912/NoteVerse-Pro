// @vitest-environment jsdom

import { act, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import commonMessages from '../../../messages/en/common.json';
import editorMessages from '../../../messages/en/editor.json';
import { HistoryProvider, useHistory } from '@/contexts/editor-history-context';
import { EditorStateProvider, useEditorState } from '@/contexts/editor-state-context';
import { ScoreDataProvider, useScoreData } from '@/contexts/score-data-context';
import {
  findVoiceEventByMusicXmlElementIds,
  importMusicXmlToEditorDomain,
  type DomainAnchor,
} from '@/lib/editor-domain';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import { EventInspector } from './event-inspector';

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
  return (
    <NextIntlClientProvider locale="en" messages={{ common: commonMessages, editor: editorMessages }}>
      <ScoreDataProvider>
        <HistoryProvider>
          <EditorStateProvider>
            {children}
            <EventInspector scoreInspectorOpen={false} onCloseScoreInspector={() => undefined} />
          </EditorStateProvider>
        </HistoryProvider>
      </ScoreDataProvider>
    </NextIntlClientProvider>
  );
}

function getDomainEventAnchor(xml: string, sourceIds: string[]): DomainAnchor {
  const imported = importMusicXmlToEditorDomain(xml);
  const event = findVoiceEventByMusicXmlElementIds(imported.document, sourceIds);
  if (!event) {
    throw new Error(`Test fixture source ids do not resolve to a domain event: ${sourceIds.join(', ')}`);
  }
  return { kind: 'event', eventId: event.id };
}

describe('EventInspector domain save path', () => {
  it('opens from a domain-only selection without legacy parsed event context', () => {
    const xml = scoreXml(`
      <note id="domain-only-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.editorState.openEditingSelection({
        domainAnchor: { kind: 'event', eventId: 'P1-m1-e4' as never },
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const inspector = screen.getByText('Selected').closest('aside');
    expect(inspector).toHaveAttribute('data-domain-inspector-kind', 'pitchedEvent');
    expect(inspector).toHaveAttribute('data-domain-inspector-source', 'domainAnchor');
    expect(inspector).toHaveAttribute('data-domain-inspector-controls-source', 'domainViewModel');
    expect(result.current.editorState.editingSelection?.domainAnchor).toEqual({ kind: 'event', eventId: 'P1-m1-e4' });
  });

  it('saves beam-run direction through domain notation controls', async () => {
    const xml = scoreXml(`
      <note id="beam-a">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">begin</beam>
      </note>
      <note id="beam-b">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">end</beam>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    const selectedMeta = selected?.meta;
    expect(selectedMeta).toBeDefined();
    if (!selected || !selectedMeta) return;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: { kind: 'event', eventId: 'P1-m1-e4' as never },
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    await user.click(screen.getByText('Beam'));
    await user.click(screen.getByLabelText('Below'));

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(Array.from(xmlDoc.querySelectorAll('note > beam')).map((beam) => beam.textContent)).toEqual([
      'begin',
      'end',
    ]);
    expect(Array.from(xmlDoc.querySelectorAll('note > stem')).map((stem) => stem.textContent)).toEqual([
      'down',
      'down',
    ]);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('saves beam relationship edits through domain commands', async () => {
    const xml = scoreXml(`
      <note id="beam-a">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">begin</beam>
      </note>
      <note id="beam-b">
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">continue</beam>
      </note>
      <note id="beam-c">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">continue</beam>
      </note>
      <note id="beam-d">
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>2</duration>
        <voice>1</voice>
        <type>eighth</type>
        <beam number="1">end</beam>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[1];
    const selectedMeta = selected?.meta;
    expect(selectedMeta).toBeDefined();
    if (!selected || !selectedMeta) return;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    await user.click(screen.getByText('Beam'));
    await user.click(screen.getByLabelText('Break beam on the right'));

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(Array.from(xmlDoc.querySelectorAll('note > beam')).map((beam) => beam.textContent)).toEqual([
      'begin',
      'end',
      'begin',
      'end',
    ]);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('deletes tie relationships through domain commands', async () => {
    const xml = scoreXml(`
      <note id="tie-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><tied type="start"/></notations>
      </note>
      <note id="tie-stop">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="stop"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><tied type="stop"/></notations>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    const selectedMeta = selected?.meta;
    expect(selectedMeta).toBeDefined();
    if (!selected || !selectedMeta) return;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    await user.click(screen.getByRole('button', { name: 'Delete connection' }));

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelectorAll('note > tie')).toHaveLength(0);
    expect(xmlDoc.querySelectorAll('note > notations > tied')).toHaveLength(0);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('saves tie direction through domain notation controls', async () => {
    const xml = scoreXml(`
      <note id="tie-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="start"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><tied type="start"/></notations>
      </note>
      <note id="tie-stop">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <tie type="stop"/>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><tied type="stop"/></notations>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    const selectedMeta = selected?.meta;
    expect(selectedMeta).toBeDefined();
    if (!selected || !selectedMeta) return;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    await user.click(screen.getByLabelText('above'));

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelector('note > notations > tied[type="start"]')?.getAttribute('orientation')).toBe('over');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('deletes slur relationships through domain commands', async () => {
    const xml = scoreXml(`
      <note id="slur-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note id="slur-stop">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    const selectedMeta = selected?.meta;
    expect(selectedMeta).toBeDefined();
    if (!selected || !selectedMeta) return;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const deleteButtons = screen.getAllByRole('button', { name: 'Delete connection' });
    await user.click(deleteButtons[0]);

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelectorAll('note > notations > slur')).toHaveLength(0);
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('saves slur direction through domain notation controls', async () => {
    const xml = scoreXml(`
      <note id="slur-start">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><slur type="start" number="1"/></notations>
      </note>
      <note id="slur-stop">
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
        <staff>1</staff>
        <notations><slur type="stop" number="1"/></notations>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    const selectedMeta = selected?.meta;
    expect(selectedMeta).toBeDefined();
    if (!selected || !selectedMeta) return;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    await user.click(screen.getByLabelText('above'));

    const nextXml = result.current.scoreData.currentXml ?? '';
    const xmlDoc = new DOMParser().parseFromString(nextXml, 'application/xml');
    expect(xmlDoc.querySelector('note > notations > slur[type="start"]')?.getAttribute('placement')).toBe('above');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
  });

  it('saves matched pitched stem edits through domain export and keeps the domain selection active', async () => {
    const xml = scoreXml(`
      <note id="editable-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('note');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    expect(screen.getByText('Selected')).toBeInTheDocument();
    await user.click(screen.getByLabelText('down'));

    const nextXml = result.current.scoreData.currentXml ?? '';
    expect(nextXml).toContain('<stem>down</stem>');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'note',
      stemDirection: 'down',
    });
  });

  it('saves matched pitched rhythm edits through domain export and keeps the domain selection active', async () => {
    const xml = scoreXml(`
      <note id="editable-rhythm-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('note');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const durationTrigger = screen.getAllByText('Quarter Note')
      .map((node) => node.closest('button'))
      .find((button): button is HTMLButtonElement => Boolean(button));
    expect(durationTrigger).toBeTruthy();
    if (!durationTrigger) return;
    await user.click(durationTrigger);
    await user.click(await screen.findByRole('option', { name: 'Half Note' }));
    await user.click(screen.getByRole('checkbox', { name: 'Dotted' }));

    const nextXml = result.current.scoreData.currentXml ?? '';
    expect(nextXml).toContain('<type>half</type>');
    expect(nextXml).toContain('<dot/>');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'note',
      duration: 'durationHalf',
      dotted: true,
    });
  });

  it('saves matched explicit rest rhythm edits through domain export and keeps the domain selection active', async () => {
    const xml = scoreXml(`
      <note id="editable-rest">
        <rest/>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('rest');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const durationTrigger = screen.getAllByText('Quarter Note')
      .map((node) => node.closest('button'))
      .find((button): button is HTMLButtonElement => Boolean(button));
    expect(durationTrigger).toBeTruthy();
    if (!durationTrigger) return;
    await user.click(durationTrigger);
    await user.click(await screen.findByRole('option', { name: 'Half Note' }));

    const nextXml = result.current.scoreData.currentXml ?? '';
    expect(nextXml).toContain('<rest/>');
    expect(nextXml).toContain('<type>half</type>');
    expect(nextXml).toContain('<duration>8</duration>');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'rest',
      duration: 'durationHalf',
    });
  });

  it('saves matched single-note pitch-name edits through domain export and keeps the domain selection active', async () => {
    const xml = scoreXml(`
      <note id="editable-pitch-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('note');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const pitchTrigger = screen.getByText('C').closest('button');
    expect(pitchTrigger).toBeTruthy();
    if (!pitchTrigger) return;
    await user.click(pitchTrigger);
    await user.click(await screen.findByRole('option', { name: 'D' }));

    const nextXml = result.current.scoreData.currentXml ?? '';
    expect(nextXml).toContain('<step>D</step>');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'note',
      pitch: 'D4',
    });
  });

  it('saves matched chord-member pitch-name edits through domain export and refreshes the selected chord', async () => {
    const xml = scoreXml(`
      <note id="chord-root">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="chord-member">
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('chord');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const secondPitchTrigger = screen.getByText('E').closest('button');
    expect(secondPitchTrigger).toBeTruthy();
    if (!secondPitchTrigger) return;
    await user.click(secondPitchTrigger);
    await user.click(await screen.findByRole('option', { name: 'G' }));

    const nextXml = result.current.scoreData.currentXml ?? '';
    expect(nextXml).toContain('<step>C</step>');
    expect(nextXml).toContain('<step>G</step>');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');

    const refreshedScoreEvent = result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(refreshedScoreEvent?.type).toBe('chord');
    if (refreshedScoreEvent?.type === 'chord') {
      expect(refreshedScoreEvent.pitches).toEqual(['C4', 'G4']);
    }
  });

  it('saves matched note-atom fingering edits through domain export and refreshes the selected chord', async () => {
    const xml = scoreXml(`
      <note id="chord-root">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="chord-member">
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('chord');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const fingeringTriggers = screen.getAllByText('None');
    const secondFingeringTrigger = fingeringTriggers[1]?.closest('button');
    expect(secondFingeringTrigger).toBeTruthy();
    if (!secondFingeringTrigger) return;
    await user.click(secondFingeringTrigger);
    await user.click(await screen.findByRole('option', { name: '4' }));

    const nextXml = result.current.scoreData.currentXml ?? '';
    expect(nextXml).toContain('<fingering>4</fingering>');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'chord',
      fingerings: ['none', '4'],
    });
  });

  it('saves matched note-atom accidental edits through domain export and refreshes the selected chord', async () => {
    const xml = scoreXml(`
      <note id="chord-root">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
      <note id="chord-member">
        <chord/>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('chord');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    const secondSharpButton = screen.getAllByRole('button', { name: 'Sharp' })[1];
    expect(secondSharpButton).toBeTruthy();
    if (!secondSharpButton) return;
    await user.click(secondSharpButton);

    const sharpXml = result.current.scoreData.currentXml ?? '';
    expect(sharpXml).toContain('<alter>1</alter>');
    expect(sharpXml).toContain('<accidental>sharp</accidental>');
    expect(result.current.history.getCurrentXml()).toBe(sharpXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');

    const sharpScoreEvent = result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(sharpScoreEvent?.type).toBe('chord');
    if (sharpScoreEvent?.type === 'chord') {
      expect(sharpScoreEvent.pitches).toEqual(['C4', 'E#4']);
      expect(sharpScoreEvent.accidentals?.[1]).toBe('sharp');
    }

    const activeSecondSharpButton = screen.getAllByRole('button', { name: 'Sharp' })[1];
    expect(activeSecondSharpButton).toBeTruthy();
    if (!activeSecondSharpButton) return;
    await user.click(activeSecondSharpButton);

    const clearedXml = result.current.scoreData.currentXml ?? '';
    expect(clearedXml).not.toContain('<alter>1</alter>');
    expect(clearedXml).not.toContain('<accidental>sharp</accidental>');
    expect(result.current.history.getCurrentXml()).toBe(clearedXml);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
  });

  it('appends a pitch to a matched note through domain export and refreshes it as a chord', async () => {
    const xml = scoreXml(`
      <note id="editable-note">
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration>
        <voice>1</voice>
        <type>quarter</type>
      </note>
    `);
    const parsed = new MusicXMLParser(xml).parse();
    const selected = parsed.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(selected?.type).toBe('note');
    expect(selected?.meta).toBeDefined();
    if (!selected?.meta) return;
    const selectedMeta = selected.meta;

    const user = userEvent.setup();
    const { result } = renderHook(() => ({
      scoreData: useScoreData(),
      editorState: useEditorState(),
      history: useHistory(),
    }), { wrapper });

    act(() => {
      result.current.scoreData.setCurrentXml(xml);
      result.current.scoreData.setScoreData(parsed);
      result.current.history.initialize(xml);
      result.current.editorState.openEditingSelection({
        domainAnchor: getDomainEventAnchor(xml, selectedMeta.sourceIds ?? [selectedMeta.id]),
        domainCompanion: null,
      });
      result.current.editorState.setInspectorOpen(true);
    });

    await user.click(screen.getByRole('button', { name: 'Add pitch' }));

    const nextXml = result.current.scoreData.currentXml ?? '';
    expect(nextXml).toContain('<note id="editable-note">');
    expect(nextXml).toContain('<note id="editable-note-chord-2">');
    expect(nextXml).toContain('<chord/>');
    expect(result.current.history.getCurrentXml()).toBe(nextXml);
    expect(result.current.editorState.inspectorOpen).toBe(true);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');

    const refreshedScoreEvent = result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0];
    expect(refreshedScoreEvent?.type).toBe('chord');
    if (refreshedScoreEvent?.type === 'chord') {
      expect(refreshedScoreEvent.pitches).toEqual(['C4', 'C4']);
    }

    const removeButtons = screen.getAllByRole('button', { name: 'Remove pitch' });
    expect(removeButtons).toHaveLength(2);
    await user.click(removeButtons[1]);

    const removedXml = result.current.scoreData.currentXml ?? '';
    expect(removedXml).not.toContain('editable-note-chord-2');
    expect(result.current.history.getCurrentXml()).toBe(removedXml);
    expect(result.current.editorState.editingSelection?.domainAnchor?.kind).toBe('event');
    expect(result.current.scoreData.scoreData?.measures[0]?.staves[0]?.voices[0]?.events[0]).toMatchObject({
      type: 'note',
      pitch: 'C4',
    });
  });
});
