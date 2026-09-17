// @vitest-environment jsdom

import React, { useEffect, useRef, type MouseEventHandler, type RefObject } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScoreData } from '@/types/score-types';
import type {
  InputDuration,
  MeasureId,
  PartId,
  Pitch,
  RhythmicGridResolution,
  ScoreDocument,
  ScoreDocumentId,
  StaffId,
  VoiceId,
} from '@/lib/editor-domain';
import { EditorPreviewPanel } from './editor-preview-panel';

const handleAddEntity = vi.fn();
const selectTool = vi.fn();
const setOnToolChange = vi.fn();
const setAddModeInput = vi.fn();
const setInsertionPreview = vi.fn();
let addModeInputKind: 'rest' | 'pitched' = 'rest';

const partId = 'P1' as PartId;
const measureId = 'P1:measure-1' as MeasureId;
const staffId = 'P1:staff-1' as StaffId;
const voiceId = 'P1:voice-1' as VoiceId;
const halfRestInputDuration: InputDuration = {
  kind: 'inputDuration',
  rhythm: {
    timelineDuration: { numerator: 2, denominator: 1 },
    notation: {
      base: 'half',
      dots: 0,
    },
  },
};
const quarterInputDuration: InputDuration = {
  kind: 'inputDuration',
  rhythm: {
    timelineDuration: { numerator: 1, denominator: 1 },
    notation: {
      base: 'quarter',
      dots: 0,
    },
  },
};
let currentAddModeInputDuration = halfRestInputDuration;
const sixteenthGridResolution: RhythmicGridResolution = {
  kind: 'rhythmicGridResolution',
  step: { numerator: 1, denominator: 4 },
};

const domainDocument: ScoreDocument = {
  schemaVersion: 1,
  id: 'score-document-1' as ScoreDocumentId,
  parts: [{ id: partId, name: 'Piano' }],
  staves: [{ id: staffId, partId, index: 0 }],
  voices: [{ id: voiceId, partId, homeStaffId: staffId, stemPolicy: 'automatic' }],
  measures: [{ id: measureId, number: 1 }],
  events: [],
  beamRelationships: [],
  tieRelationships: [],
  slurRelationships: [],
  notationControls: [],
};

const scoreData: ScoreData = {
  timeSignature: '4/4',
  measures: [
    {
      number: 1,
      staves: [
        {
          clef: 'treble',
          name: 'trebleClef',
          voices: [
            {
              name: 'voiceLabel 1',
              events: [],
            },
          ],
        },
      ],
    },
  ],
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/components/score-preview/score-preview-viewport', () => ({
  ScorePreviewViewport: MockScorePreviewViewport,
}));

vi.mock('@/contexts/editor-provider', () => ({
  useEditorDomainRenderAnchors: () => ({
    document: domainDocument,
    gaps: [],
    anchors: [],
    error: null,
    resolveAnchor: () => null,
  }),
  useEditorState: () => ({
    addModeGridResolution: sixteenthGridResolution,
    addModeInput: {
      kind: addModeInputKind,
      pitch: {
        step: 'C',
        octave: 4,
      } satisfies Pitch,
    },
    addModeInputDuration: currentAddModeInputDuration,
    insertionPreview: null,
    editingSelection: null,
    editorMode: 'add',
    selectTool,
    setAddModeInput,
    setInsertionPreview,
    setOnToolChange,
  }),
  useScoreData: () => ({
    scoreData,
  }),
  useXmlUpdater: () => ({
    updateMusicXML: vi.fn(),
  }),
}));

vi.mock('@/hooks/score-preview/use-score-preview-playback', () => ({
  useScorePreviewPlayback: () => ({
    containerRef: { current: null },
    scoreContainerRef: vi.fn(),
    isLoading: false,
    hasRenderedScore: true,
    loadError: null,
    currentTime: 0,
    isLooping: false,
    isPlaying: false,
    progress: 0,
    totalTime: 0,
    playPause: vi.fn(),
    seek: vi.fn(),
    seekEnd: vi.fn(),
    seekStart: vi.fn(),
    stop: vi.fn(),
    toggleLoop: vi.fn(),
  }),
}));

vi.mock('@/hooks/score/use-measure-warning-overlay', () => ({
  useMeasureWarningOverlay: () => undefined,
}));

vi.mock('@/hooks/editor/use-entity-editor', () => ({
  useEntityEditor: () => ({
    handleAddEntity,
    handleCloseModal: vi.fn(),
    handleDeleteEntity: vi.fn(),
    handleDomainSelectionCompanion: vi.fn(),
  }),
}));

vi.mock('@/hooks/editor/use-connection-operations', () => ({
  useConnectionOperations: () => ({
    handleAddSlurSelection: vi.fn(),
    handleAddTieSelection: vi.fn(),
    clearSlurSelection: vi.fn(),
    clearTieSelection: vi.fn(),
    handleDeleteSlur: vi.fn(),
    handleDeleteTie: vi.fn(),
  }),
}));

vi.mock('@/hooks/editor/use-editor-tracks', () => ({
  useEditorTracks: () => ({
    tracks: [
      {
        id: 'voice-1',
        staffIndex: 0,
        xmlVoice: 1,
        label: 'Voice 1',
        color: '#2563eb',
        entityCount: 0,
        measureCount: 0,
      },
    ],
    activeTrackId: 'voice-1',
    visibleTrackIdSet: new Set(['voice-1']),
  }),
}));

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock('@/lib/musicxml/core', async () => {
  const actual = await vi.importActual<typeof import('@/lib/musicxml/core')>('@/lib/musicxml/core');
  return {
    ...actual,
    getDivisions: () => 4,
    parseXml: () => new DOMParser().parseFromString('<score-partwise />', 'application/xml'),
  };
});

vi.mock('@/lib/musicxml/validator', () => ({
  validateDataIntegrity: () => ({ warnings: [] }),
}));

vi.mock('./editor-preview-metadata-placeholders', () => ({
  mountScoreMetadataPlaceholders: () => undefined,
}));

function MockScorePreviewViewport({
  containerRef,
  onScoreClick,
  onScoreMouseLeave,
  onScoreMouseMove,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  onScoreClick?: MouseEventHandler<HTMLDivElement>;
  onScoreMouseLeave?: MouseEventHandler<HTMLDivElement>;
  onScoreMouseMove?: MouseEventHandler<HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    containerRef.current = ref.current;
  }, [containerRef]);

  return (
    <div
      ref={ref}
      data-testid="score-preview-viewport"
      onClick={onScoreClick}
      onMouseLeave={onScoreMouseLeave}
      onMouseMove={onScoreMouseMove}
    >
      <svg>
        <g data-class="measure" data-id="measure-1" ref={setMeasureRect}>
          <g data-class="staff" ref={setStaffRect} />
        </g>
      </svg>
    </div>
  );
}

function setMeasureRect(element: SVGGElement | null): void {
  if (!element) return;
  setRect(element, { left: 90, right: 430, width: 340, top: 0, bottom: 100, height: 100 });
}

function setStaffRect(element: SVGGElement | null): void {
  if (!element) return;
  setRect(element, { left: 100, right: 400, width: 300, top: 10, bottom: 80, height: 70 });
}

function setRect(element: Element, rect: Partial<DOMRect>) {
  const resolved = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)),
    height: rect.height ?? Math.max(0, (rect.bottom ?? 0) - (rect.top ?? 0)),
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => resolved;
}

describe('EditorPreviewPanel add mode placement', () => {
  beforeAll(() => {
    globalThis.ResizeObserver ??= class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  beforeEach(() => {
    handleAddEntity.mockClear();
    selectTool.mockClear();
    setOnToolChange.mockClear();
    setAddModeInput.mockClear();
    setInsertionPreview.mockClear();
    addModeInputKind = 'rest';
    currentAddModeInputDuration = halfRestInputDuration;
  });

  it('inserts the selected add-mode rest duration at the rhythmic caret resolved from empty-staff geometry', () => {
    render(<EditorPreviewPanel active currentXml="<score-partwise />" onOpenScoreInspector={vi.fn()} />);

    fireEvent.click(screen.getByTestId('score-preview-viewport'), {
      clientX: 250,
      clientY: 40,
    });

    expect(handleAddEntity).toHaveBeenCalledWith(
      {
        kind: 'caret',
        caret: {
          kind: 'caret',
          voiceId,
          staffId,
          position: {
            measureId,
            offset: { numerator: 2, denominator: 1 },
          },
        },
      },
      {
        kind: 'insertExplicitRest',
        inputDuration: halfRestInputDuration,
      }
    );
    expect(setInsertionPreview).toHaveBeenCalledWith(expect.objectContaining({
      anchor: expect.objectContaining({
        kind: 'caret',
      }),
      inputDuration: halfRestInputDuration,
    }));
    expect(setInsertionPreview).toHaveBeenLastCalledWith(null);
  });

  it('shows the add caret at the rhythmic layout position during pointer movement', () => {
    render(<EditorPreviewPanel active currentXml="<score-partwise />" onOpenScoreInspector={vi.fn()} />);

    fireEvent.mouseMove(screen.getByTestId('score-preview-viewport'), {
      clientX: 250,
      clientY: 40,
    });

    const caret = document.querySelector('.pointer-events-none.absolute.z-10');
    expect(caret).toBeInTheDocument();
    expect(caret).toHaveStyle({
      left: '250px',
    });
    const gridMarkers = screen.getAllByTestId('add-mode-grid-marker');
    expect(gridMarkers).toHaveLength(9);
    expect(gridMarkers[0]).toHaveStyle({
      top: '0px',
      height: '24px',
    });
    expect(screen.queryByTestId('add-mode-ghost-note')).not.toBeInTheDocument();
    expect(setInsertionPreview).toHaveBeenCalledWith(expect.objectContaining({
      anchor: expect.objectContaining({
        kind: 'caret',
      }),
      inputDuration: halfRestInputDuration,
    }));
  });

  it('uses the selected add-mode grid resolution for empty-staff pointer placement', () => {
    render(<EditorPreviewPanel active currentXml="<score-partwise />" onOpenScoreInspector={vi.fn()} />);

    fireEvent.click(screen.getByTestId('score-preview-viewport'), {
      clientX: 200,
      clientY: 40,
    });

    expect(handleAddEntity).toHaveBeenCalledWith(
      {
        kind: 'caret',
        caret: {
          kind: 'caret',
          voiceId,
          staffId,
          position: {
            measureId,
            offset: { numerator: 5, denominator: 4 },
          },
        },
      },
      {
        kind: 'insertExplicitRest',
        inputDuration: halfRestInputDuration,
      }
    );
  });

  it('inserts a pitched event when note input is active', () => {
    addModeInputKind = 'pitched';
    render(<EditorPreviewPanel active currentXml="<score-partwise />" onOpenScoreInspector={vi.fn()} />);

    fireEvent.click(screen.getByTestId('score-preview-viewport'), {
      clientX: 250,
      clientY: 40,
    });

    expect(handleAddEntity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'caret',
      }),
      {
        kind: 'insertPitchedEvent',
        inputDuration: halfRestInputDuration,
        pitch: {
          step: 'C',
          octave: 5,
        },
      }
    );
    expect(setAddModeInput).toHaveBeenCalledWith(expect.any(Function));
  });

  it('shows a ghost notehead at the resolved pitch while note input is active', () => {
    addModeInputKind = 'pitched';
    render(<EditorPreviewPanel active currentXml="<score-partwise />" onOpenScoreInspector={vi.fn()} />);

    fireEvent.mouseMove(screen.getByTestId('score-preview-viewport'), {
      clientX: 250,
      clientY: 40,
    });

    const ghostNote = screen.getByTestId('add-mode-ghost-note');
    expect(ghostNote).toBeInTheDocument();
    expect(ghostNote).toHaveStyle({
      left: '241px',
      top: '30.25px',
      width: '18px',
      height: '12px',
    });
    expect(ghostNote.style.backgroundColor).toBe('transparent');
    expect(screen.queryByTestId('add-mode-ghost-ledger-line')).not.toBeInTheDocument();
  });

  it('shows a filled ghost notehead for quarter and shorter note input', () => {
    addModeInputKind = 'pitched';
    currentAddModeInputDuration = quarterInputDuration;
    render(<EditorPreviewPanel active currentXml="<score-partwise />" onOpenScoreInspector={vi.fn()} />);

    fireEvent.mouseMove(screen.getByTestId('score-preview-viewport'), {
      clientX: 250,
      clientY: 40,
    });

    expect(screen.getByTestId('add-mode-ghost-note')).toHaveStyle({
      backgroundColor: '#2563eb',
    });
  });

  it('shows ledger lines when the ghost notehead is outside the staff', () => {
    addModeInputKind = 'pitched';
    render(<EditorPreviewPanel active currentXml="<score-partwise />" onOpenScoreInspector={vi.fn()} />);

    fireEvent.mouseMove(screen.getByTestId('score-preview-viewport'), {
      clientX: 250,
      clientY: 0,
    });

    const ledgerLines = screen.getAllByTestId('add-mode-ghost-ledger-line');
    expect(ledgerLines).toHaveLength(1);
    expect(ledgerLines[0]).toHaveStyle({
      left: '237px',
      top: '-7.5px',
      width: '26px',
    });
  });
});
