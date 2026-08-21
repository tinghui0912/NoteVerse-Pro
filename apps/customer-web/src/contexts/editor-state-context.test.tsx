// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { DomainSelectionCompanion } from '@/lib/editor/domain-selection-companion';
import { EditorStateProvider, useEditorState } from './editor-state-context';

function wrapper({ children }: { children: ReactNode }) {
  return <EditorStateProvider>{children}</EditorStateProvider>;
}

describe('EditorStateProvider editing selection', () => {
  it('stores note-entry insertion preview independently from Inspector selection', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });
    const insertionPreview = {
      anchor: {
        kind: 'caret' as const,
        caret: {
          kind: 'caret' as const,
          staffId: 'P1:staff-1' as never,
          voiceId: 'P1:voice-1' as never,
          position: {
            measureId: 'P1:measure-1' as never,
            offset: { numerator: 3, denominator: 2 },
          },
        },
      },
      inputDuration: {
        kind: 'inputDuration' as const,
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter' as const, dots: 0 },
        },
      },
    };

    act(() => {
      result.current.setInsertionPreview(insertionPreview);
    });

    expect(result.current.insertionPreview).toEqual(insertionPreview);
    expect(result.current.editingSelection).toBeNull();
  });

  it('uses the domain companion anchor as canonical selection identity', () => {
    const companion: DomainSelectionCompanion = {
      domainAnchor: { kind: 'event', eventId: 'event-1' as never },
      inspectorViewModel: {
        kind: 'pitchedEvent',
        eventId: 'event-1' as never,
        displayKind: 'note',
        voiceId: 'P1:voice-1' as never,
        staffId: 'P1:staff-1' as never,
        position: {
          measureId: 'P1:measure-1' as never,
          offset: { numerator: 0, denominator: 1 },
        },
        rhythm: {
          timelineDuration: { numerator: 1, denominator: 1 },
          notation: { base: 'quarter', dots: 0 },
        },
        notes: [],
      },
    };
    const { result } = renderHook(() => useEditorState(), { wrapper });

    act(() => {
      result.current.openEditingSelection({
        domainCompanion: companion,
      });
    });

    expect(result.current.editingSelection?.domainAnchor).toEqual(companion.domainAnchor);
  });

  it('allows domain-only editing selection without legacy parsed event context', () => {
    const { result } = renderHook(() => useEditorState(), { wrapper });

    act(() => {
      result.current.openEditingSelection({
        domainAnchor: { kind: 'event', eventId: 'event-1' as never },
        domainCompanion: null,
      });
    });

    expect(result.current.editingSelection).toMatchObject({
      domainAnchor: { kind: 'event', eventId: 'event-1' },
      domainCompanion: null,
    });
  });
});
