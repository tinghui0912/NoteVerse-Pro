// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { EditorSessionProvider, useEditorSession } from '@/contexts/editor-session-context';
import { useEditorDomainEdit } from './use-editor-domain-edit';
import { editorXml, note } from '../../../tests/fixtures/editor';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
function setup() {
  const hook = renderHook(() => ({ session: useEditorSession(), edit: useEditorDomainEdit() }), {
    wrapper: EditorSessionProvider,
  });
  act(() => {
    hook.result.current.session.loadMusicXml(
      editorXml(
        note('n1', 'C', 1, 4, 'eighth') + note('n2', 'C', 1, 4, 'eighth') + note('n3', 'E'),
      ),
    );
  });
  return hook;
}
describe('Editor domain mutation wiring', () => {
  it('accepts an Inspector command and keeps selection on the same event', () => {
    const { result } = setup();
    const event = result.current.session.document!.events[0];
    act(() => {
      const accepted = result.current.edit.applyDomainInspectorEdit({
        draft: {
          kind: 'pitchedEvent',
          eventId: event.id,
          rhythm: {
            timelineDuration: { numerator: 1, denominator: 1 },
            notation: { base: 'quarter', dots: 0 },
          },
        },
        reselectSourceIds: ['n1'],
      });
      expect(accepted.success).toBe(true);
      if (accepted.success) expect(accepted.refreshedSelection?.id).toBe(event.id);
    });
    expect(result.current.session.document!.events[0].rhythm.notation.base).toBe('quarter');
    expect(result.current.session.canUndo).toBe(true);
  });
  it('retargets concrete note source anchors for pitch and fingering edits', () => {
    const { result } = setup();
    act(() => {
      result.current.edit.applyDomainInspectorEdit({
        draft: {
          kind: 'noteAtom',
          eventId: 'unresolved' as never,
          noteAtomId: 'unresolved' as never,
          pitch: { step: 'F', octave: 5 },
          fingering: '2',
        },
        retargetNoteAtomSourceId: 'n1',
        reselectSourceIds: ['n1'],
      });
    });
    const event = result.current.session.document!.events[0];
    expect(event.kind === 'pitched' && event.notes[0]).toMatchObject({
      pitch: { step: 'F', octave: 5 },
      fingering: '2',
    });
    expect(result.current.session.serializedXml).toContain('Preserved rights');
  });
  it('sets and clears explicit stem direction without rebuilding the document', () => {
    const { result } = setup();
    act(() => {
      result.current.edit.applyDomainStemDirectionToSourceIds({
        sourceIds: ['n1', 'n2'],
        stemDirection: 'up',
      });
    });
    expect(result.current.session.document?.notationControls).toHaveLength(2);
    act(() => {
      result.current.edit.applyDomainStemDirectionToSourceIds({ sourceIds: ['n1', 'n2'] });
    });
    expect(result.current.session.document?.notationControls).toEqual([]);
  });
  it('joins and splits beam relationships through domain commands', () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.edit.applyDomainBeamRelationshipEditBySourceId({
          sourceId: 'n1',
          action: 'next',
        }).success,
      ).toBe(true);
    });
    expect(result.current.session.document?.beamRelationships).toHaveLength(1);
    act(() => {
      expect(
        result.current.edit.applyDomainBeamRelationshipEditBySourceId({
          sourceId: 'n1',
          action: 'break-right',
        }).success,
      ).toBe(true);
    });
    expect(result.current.session.document?.beamRelationships).toEqual([]);
  });
  it('adds, positions and removes ties through the same session transaction', () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.edit.addDomainTieRelationshipsBySourceIds({
          startSourceIds: ['n1'],
          endSourceIds: ['n2'],
        }).success,
      ).toBe(true);
    });
    expect(result.current.session.document?.tieRelationships).toHaveLength(1);
    act(() => {
      result.current.edit.setDomainTiePlacementBySourceIds({
        sourceId: 'n1',
        partnerSourceId: 'n2',
        placement: 'above',
      });
    });
    expect(result.current.session.serializedXml).toContain('orientation="over"');
    act(() => {
      expect(
        result.current.edit.deleteDomainTieRelationshipsForSourceIds({ sourceIds: ['n1'] }).success,
      ).toBe(true);
    });
    expect(result.current.session.document?.tieRelationships).toEqual([]);
  });
  it('adds, positions and removes slurs from typed endpoints', () => {
    const { result } = setup();
    act(() => {
      expect(
        result.current.edit.addDomainSlurRelationshipsBySourceIds({
          startSourceIds: ['n1'],
          endSourceIds: ['n3'],
        }).success,
      ).toBe(true);
    });
    act(() => {
      result.current.edit.setDomainSlurPlacementBySourceIds({
        sourceId: 'n1',
        partnerSourceId: 'n3',
        placement: 'below',
      });
    });
    expect(result.current.session.serializedXml).toContain('placement="below"');
    act(() => {
      expect(
        result.current.edit.deleteDomainSlurRelationshipsForSourceIds({ sourceIds: ['n1'] })
          .success,
      ).toBe(true);
    });
    expect(result.current.session.document?.slurRelationships).toEqual([]);
  });
  it('rejects commands when there is no loaded document', () => {
    const { result } = renderHook(useEditorDomainEdit, { wrapper: EditorSessionProvider });
    expect(
      result.current.applyDomainStemDirectionToSourceIds({ sourceIds: ['n1'], stemDirection: 'up' })
        .success,
    ).toBe(false);
  });
});
