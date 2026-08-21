'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ScorePreviewViewport } from '@/components/score-preview/score-preview-viewport';
import { Button } from '@/components/ui/button';
import {
  useEditorDomainRenderAnchors,
  useEditorState,
  useScoreData,
} from '@/contexts/editor-provider';
import { useScorePreviewPlayback } from '@/hooks/score-preview/use-score-preview-playback';
import { useMeasureWarningOverlay } from '@/hooks/score/use-measure-warning-overlay';
import { useEntityEditor } from '@/hooks/editor/use-entity-editor';
import { createAddModeInsertCommand, type AddModeInsertCommand } from '@/hooks/editor/entity-editor';
import { useConnectionOperations } from '@/hooks/editor/use-connection-operations';
import { useEditorTracks } from '@/hooks/editor/use-editor-tracks';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { getDivisions, parseXml } from '@/lib/musicxml/core';
import {
  getVerovioRenderElementIdFromTarget,
  getVerovioMeasureElementFromTarget,
  getVerovioMeasureIndexFromTarget,
  getVerovioStaffElementForIndex,
} from '@/lib/editor/verovio-entity-map';
import {
  getConnectionTarget,
  type ConnectionTarget,
} from '@/lib/editor/connection-target';
import { createDomainSelectionCompanion } from '@/lib/editor/domain-selection-companion';
import { resolveRhythmicInsertPlacement } from '@/lib/editor/rhythmic-insert-placement';
import {
  getMeasureElementFromPoint,
  getMeasureIndex,
  getStaveIndexFromPointer,
} from '@/lib/editor/verovio-geometry';
import {
  getLedgerLineOffsets,
  resolvePitchPositionFromStaffPointer,
  type StaffPitchClef,
} from '@/lib/editor/staff-pitch-resolver';
import { validateDataIntegrity } from '@/lib/musicxml/validator';
import { getTrackColor } from '@/lib/editor/tracks';
import { getRenderIdsForDomainAnchor, type DomainAnchor, type InputDuration, type InsertionAnchor, type RenderAnchor, type ScoreDocument } from '@/lib/editor-domain';
import { EditorBottomPlayer } from './editor-bottom-player';
import {
  getHiddenConnectionPairs,
  getHiddenSourceIds,
  getHiddenStaffKeys,
} from './editor-preview-track-visibility';
import { applySelectedVerovioElements } from './editor-preview-selection-highlight';
import { mountScoreMetadataPlaceholders } from './editor-preview-metadata-placeholders';
import type { AddLocation } from '@/types/score-types';

interface EditorPreviewPanelProps {
  active: boolean;
  currentXml: string | null;
  onOpenScoreInspector: () => void;
}

type AddModePreview = {
  location: AddLocation | null;
  insertionAnchor: InsertionAnchor;
  command: AddModeInsertCommand;
  style: CSSProperties;
  gridMarkerStyles: CSSProperties[];
  ghostNoteheadKind?: 'filled' | 'open';
  pitchStyle?: CSSProperties;
  ledgerLineStyles?: CSSProperties[];
};

type SvgBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const VEROVIO_CONNECTION_SELECTOR = [
  '[data-class="tie"]',
  '[data-class="slur"]',
  '[data-class="beam"]',
].join(', ');
const VEROVIO_EVENT_CONTAINER_SELECTOR = [
  '[data-class="chord"]',
  '[data-class="note"]',
  '[data-class="rest"]',
  '[data-class="mRest"]',
].join(', ');
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function isScoreMetadataTarget(container: Element | null, target: EventTarget | null, clientY: number): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-score-metadata-placeholder]')) return true;

  const page = target.closest('[data-score-page]');
  if (!container || !page || !container.contains(page)) return false;

  const system = page.querySelector('.system');
  if (!system) return false;

  const systemTop = system.getBoundingClientRect().top;
  const pageTop = page.getBoundingClientRect().top;
  const isAboveFirstSystem = clientY >= pageTop && clientY < systemTop - 4;
  const isTextElement = Boolean(target.closest('text, tspan, [data-class="dir"], .dir, .anchoredText, .rend'));

  return isAboveFirstSystem && isTextElement;
}

function getCaretStyle(event: MouseEvent<HTMLDivElement>, element: Element, left: number): CSSProperties {
  const viewportRect = event.currentTarget.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  return {
    left: `${left - viewportRect.left + event.currentTarget.scrollLeft}px`,
    top: `${elementRect.top - viewportRect.top + event.currentTarget.scrollTop - 8}px`,
    height: `${Math.max(28, elementRect.height + 16)}px`,
  };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[\da-f]{6}$/i.test(normalized)) return null;

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function getCaretColorStyle(color: string | undefined): CSSProperties {
  const fallback = '#2563eb';
  const resolvedColor = color || fallback;
  const rgb = hexToRgb(resolvedColor);
  const glow = rgb
    ? `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.18)`
    : '0 0 0 3px rgba(37, 99, 235, 0.18)';

  return {
    backgroundColor: resolvedColor,
    boxShadow: glow,
  };
}

function getGhostNoteColorStyle(color: string | undefined): CSSProperties {
  const resolvedColor = color || '#2563eb';
  return {
    borderColor: resolvedColor,
    backgroundColor: resolvedColor,
  };
}

function getGhostNoteheadColorStyle(color: string | undefined, kind: AddModePreview['ghostNoteheadKind']): CSSProperties {
  const resolvedColor = color || '#2563eb';
  return {
    borderColor: resolvedColor,
    backgroundColor: kind === 'open' ? 'transparent' : resolvedColor,
  };
}

function getGhostNoteheadKind(inputDuration: InputDuration): 'filled' | 'open' {
  const base = inputDuration.rhythm.notation.base;
  return base === 'whole' || base === 'half' ? 'open' : 'filled';
}

function getGhostNoteStyle(
  event: MouseEvent<HTMLDivElement>,
  left: number,
  centerY: number
): CSSProperties {
  const viewportRect = event.currentTarget.getBoundingClientRect();
  const width = 18;
  const height = 12;

  return {
    left: `${left - viewportRect.left + event.currentTarget.scrollLeft - width / 2}px`,
    top: `${centerY - viewportRect.top + event.currentTarget.scrollTop - height / 2}px`,
    width: `${width}px`,
    height: `${height}px`,
  };
}

function getGridMarkerStyles(
  event: MouseEvent<HTMLDivElement>,
  element: Element,
  gridLines: number[]
): CSSProperties[] {
  const viewportRect = event.currentTarget.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top = Math.max(
    event.currentTarget.scrollTop,
    elementRect.top - viewportRect.top + event.currentTarget.scrollTop - 34
  );

  return gridLines.map((left) => ({
    left: `${left - viewportRect.left + event.currentTarget.scrollLeft}px`,
    top: `${top}px`,
    height: '24px',
  }));
}

function getLedgerLineStyles(
  event: MouseEvent<HTMLDivElement>,
  left: number,
  pitchPosition: {
    diatonicOffsetFromBottomLine: number;
    lineSpacing: number;
    centerY: number;
  }
): CSSProperties[] {
  const ledgerLineOffsets = getLedgerLineOffsets(pitchPosition.diatonicOffsetFromBottomLine);
  if (ledgerLineOffsets.length === 0) return [];

  const viewportRect = event.currentTarget.getBoundingClientRect();
  const width = 26;
  return ledgerLineOffsets.map((offset) => ({
    left: `${left - viewportRect.left + event.currentTarget.scrollLeft - width / 2}px`,
    top: `${pitchPosition.centerY
      - viewportRect.top
      + event.currentTarget.scrollTop
      - ((offset - pitchPosition.diatonicOffsetFromBottomLine) * pitchPosition.lineSpacing) / 2}px`,
    width: `${width}px`,
  }));
}

function getInsertVerticalAnchor(measureElement: Element | null, staveIndex: number): Element | null {
  return getVerovioStaffElementForIndex(measureElement, staveIndex) ?? measureElement;
}

function resolvePitchedConnectionTarget(
  document: ScoreDocument | null,
  domainAnchor: DomainAnchor | null,
  domainAnchors: RenderAnchor[]
): ConnectionTarget | null {
  return getConnectionTarget(document, domainAnchor, domainAnchors);
}

function isSameAddLocation(left: AddLocation | null, right: AddLocation): boolean {
  return Boolean(left)
    && left?.measureIndex === right.measureIndex
    && left.staveIndex === right.staveIndex
    && left.xmlVoice === right.xmlVoice
    && left.tick === right.tick;
}

function getHiddenVerovioEventElement(element: Element): Element {
  return element.closest(VEROVIO_EVENT_CONTAINER_SELECTOR)
    ?? element;
}

function getVerovioChordElement(element: Element): Element | null {
  return element.closest('[data-class="chord"]');
}

function getEventSourceId(element: Element): string | null {
  return element.getAttribute('data-id') || element.getAttribute('id');
}

function shouldHideWholeChord(chordElement: Element, hiddenSourceIds: Set<string>): boolean {
  const eventChildren = Array.from(chordElement.querySelectorAll(VEROVIO_EVENT_CONTAINER_SELECTOR));
  const sourceIds = eventChildren
    .map(getEventSourceId)
    .filter((id): id is string => Boolean(id));

  return sourceIds.length > 0 && sourceIds.every((id) => hiddenSourceIds.has(id));
}

function getRelatedIds(element: Element): string[] {
  return (element.getAttribute('data-related') ?? '')
    .split(/\s+/)
    .map((value) => value.trim().replace(/^#/, ''))
    .filter(Boolean);
}

function getNumbers(value: string | null): number[] {
  return value?.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
}

function getSvgBoundsFromGraphics(element: Element): SvgBounds | null {
  const xValues: number[] = [];
  const yValues: number[] = [];

  const addPoint = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    xValues.push(x);
    yValues.push(y);
  };

  element.querySelectorAll('path').forEach((path) => {
    const values = getNumbers(path.getAttribute('d'));
    for (let index = 1; index < values.length; index += 2) {
      addPoint(values[index - 1], values[index]);
    }
  });

  element.querySelectorAll('polygon').forEach((polygon) => {
    const values = getNumbers(polygon.getAttribute('points'));
    for (let index = 1; index < values.length; index += 2) {
      addPoint(values[index - 1], values[index]);
    }
  });

  element.querySelectorAll('ellipse').forEach((ellipse) => {
    const cx = Number(ellipse.getAttribute('cx'));
    const cy = Number(ellipse.getAttribute('cy'));
    const rx = Number(ellipse.getAttribute('rx') ?? 0);
    const ry = Number(ellipse.getAttribute('ry') ?? 0);
    addPoint(cx - rx, cy - ry);
    addPoint(cx + rx, cy + ry);
  });

  element.querySelectorAll('use').forEach((use) => {
    const values = getNumbers(use.getAttribute('transform'));
    if (values.length >= 2) {
      addPoint(values[0], values[1]);
    }
  });

  if (xValues.length === 0 || yValues.length === 0) return null;

  return {
    minX: Math.min(...xValues),
    maxX: Math.max(...xValues),
    minY: Math.min(...yValues),
    maxY: Math.max(...yValues),
  };
}

function isConnectionNearHiddenEvent(connectionBounds: SvgBounds, hiddenEventBounds: SvgBounds): boolean {
  const xTolerance = 720;
  const yTolerance = 720;
  const connectionCenterY = (connectionBounds.minY + connectionBounds.maxY) / 2;
  const overlapsX = connectionBounds.maxX >= hiddenEventBounds.minX - xTolerance
    && connectionBounds.minX <= hiddenEventBounds.maxX + xTolerance;
  const overlapsY = connectionCenterY >= hiddenEventBounds.minY - yTolerance
    && connectionCenterY <= hiddenEventBounds.maxY + yTolerance;

  return overlapsX && overlapsY;
}

function addBounds(boundsBySourceId: Map<string, SvgBounds[]>, sourceId: string, bounds: SvgBounds | null): void {
  if (!bounds) return;
  const existing = boundsBySourceId.get(sourceId) ?? [];
  existing.push(bounds);
  boundsBySourceId.set(sourceId, existing);
}

function isConnectionNearEndpointPair(
  connectionBounds: SvgBounds,
  startBounds: SvgBounds,
  endBounds: SvgBounds
): boolean {
  return isConnectionNearHiddenEvent(connectionBounds, startBounds)
    && isConnectionNearHiddenEvent(connectionBounds, endBounds);
}

function isConnectionNearAnyEndpoint(
  connectionBounds: SvgBounds,
  endpointBounds: SvgBounds[]
): boolean {
  return endpointBounds.some((bounds) => isConnectionNearHiddenEvent(connectionBounds, bounds));
}

function getDomainAnchorTrackColor(
  document: ScoreDocument | null,
  anchor: DomainAnchor | null,
): string | undefined {
  const eventId = anchor?.kind === 'event' || anchor?.kind === 'noteAtom'
    ? anchor.eventId
    : null;
  if (!document || !eventId) return undefined;

  const event = document.events.find((candidate) => candidate.id === eventId);
  if (!event) return undefined;

  return getTrackColor(
    Math.max(0, getTrailingNumber(String(event.staffId), 1) - 1),
    getTrailingNumber(String(event.voiceId), 1),
  );
}

function getTrailingNumber(value: string, fallback: number): number {
  const match = value.match(/(\d+)$/);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function EditorPreviewPanel({ active, currentXml, onOpenScoreInspector }: EditorPreviewPanelProps) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const { scoreData } = useScoreData();
  const domainRenderAnchors = useEditorDomainRenderAnchors();
  const {
    document: domainDocument,
    gaps: domainGaps,
    anchors: domainAnchors,
    error: domainAnchorError,
    resolveAnchor: resolveDomainAnchor,
  } = domainRenderAnchors;
  const {
    addModeGridResolution,
    addModeInput,
    addModeInputDuration,
    insertionPreview,
    editingSelection,
    editorMode,
    selectTool,
    setAddModeInput,
    setInsertionPreview,
    setOnToolChange,
  } = useEditorState();
  const { tracks, activeTrackId, visibleTrackIdSet } = useEditorTracks();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const {
    handleAddEntity,
    handleCloseModal,
    handleDeleteEntity,
    handleDomainSelectionCompanion,
  } = useEntityEditor();
  const {
    handleAddSlurSelection,
    handleAddTieSelection,
    clearSlurSelection,
    clearTieSelection,
    handleDeleteSlur,
    handleDeleteTie,
  } = useConnectionOperations({ currentXml });
  const [addModePreview, setAddModePreview] = useState<AddModePreview | null>(null);
  const [lastDomainAnchorKind, setLastDomainAnchorKind] = useState<string | null>(null);
  const [lastDomainCompanionKind, setLastDomainCompanionKind] = useState<string | null>(null);
  const playback = useScorePreviewPlayback({
    isOpen: active,
    xmlString: currentXml,
  });
  const activeTrack = useMemo(
    () => tracks.find((track) => track.id === activeTrackId) ?? tracks[0],
    [activeTrackId, tracks]
  );
  const getInsertTarget = useCallback((
    event: MouseEvent<HTMLDivElement>,
    measureElement: Element | null,
    fallbackStaveIndex: number,
    fallbackXmlVoice: number
  ) => {
    const staveIndex = getStaveIndexFromPointer(measureElement, event.clientY)
      ?? activeTrack?.staffIndex
      ?? fallbackStaveIndex;

    return {
      staveIndex,
      xmlVoice: activeTrack?.xmlVoice ?? fallbackXmlVoice,
    };
  }, [activeTrack?.staffIndex, activeTrack?.xmlVoice]);
  const divisions = useMemo(() => {
    if (!currentXml) return 1;
    return getDivisions(parseXml(currentXml));
  }, [currentXml]);
  const resolvePointerAddModePreviewInput = useCallback((
    event: MouseEvent<HTMLDivElement>,
    measureElement: Element,
    measureIndex: number,
    staveIndex: number,
    left: number,
  ) => {
    if (addModeInput.kind !== 'pitched') {
      return {
        input: addModeInput,
        pitchStyle: undefined,
      };
    }
    const clef = scoreData?.measures[measureIndex]?.staves[staveIndex]?.clef as StaffPitchClef | undefined;
    const pitchPosition = resolvePitchPositionFromStaffPointer({
      staffElement: getInsertVerticalAnchor(measureElement, staveIndex),
      clientY: event.clientY,
      clef,
    });
    if (!pitchPosition) {
      return {
        input: addModeInput,
        pitchStyle: undefined,
      };
    }

    const resolvedInput = {
      ...addModeInput,
      pitch: pitchPosition.pitch,
    };
    setAddModeInput((current) => (
      current.kind === 'pitched'
      && current.pitch.step === pitchPosition.pitch.step
      && current.pitch.octave === pitchPosition.pitch.octave
      && current.pitch.alter === pitchPosition.pitch.alter
        ? current
        : resolvedInput
    ));
    return {
      input: resolvedInput,
      pitchStyle: getGhostNoteStyle(event, left, pitchPosition.centerY),
      ledgerLineStyles: getLedgerLineStyles(event, left, pitchPosition),
    };
  }, [addModeInput, scoreData?.measures, setAddModeInput]);
  const translateValidationKey = useCallback((key: string) => {
    if (!key.includes('.')) return t(key as never);
    const [namespace, ...rest] = key.split('.');
    const nestedKey = rest.join('.');
    if (namespace === 'editor') return t(nestedKey as never);
    if (namespace === 'common') return common(nestedKey as never);
    if (namespace === 'validation' || namespace === 'auth') return auth(`validation.${nestedKey}` as never);
    return key;
  }, [auth, common, t]);
  const validationIssues = useMemo(
    () => validateDataIntegrity(scoreData, currentXml, translateValidationKey).warnings,
    [currentXml, scoreData, translateValidationKey]
  );
  useMeasureWarningOverlay({
    containerRef: playback.containerRef,
    isLoading: playback.isLoading,
    issues: validationIssues,
  });
  const hiddenSourceIds = useMemo(() => {
    return getHiddenSourceIds(scoreData, visibleTrackIdSet);
  }, [scoreData, visibleTrackIdSet]);
  const hiddenConnectionPairs = useMemo(() => {
    return getHiddenConnectionPairs(hiddenSourceIds, domainDocument);
  }, [domainDocument, hiddenSourceIds]);
  const hiddenStaffKeys = useMemo(() => {
    return getHiddenStaffKeys(scoreData, visibleTrackIdSet);
  }, [scoreData, visibleTrackIdSet]);

  useEffect(() => {
    setOnToolChange(() => {
      clearTieSelection();
      clearSlurSelection();
      setAddModePreview(null);
      setInsertionPreview(null);
    });

    return () => setOnToolChange(null);
  }, [clearSlurSelection, clearTieSelection, setInsertionPreview, setOnToolChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return;
      if (!['add', 'delete', 'addTie', 'deleteTie', 'addSlur', 'deleteSlur'].includes(editorMode)) return;

      clearTieSelection();
      clearSlurSelection();
      setAddModePreview(null);
      setInsertionPreview(null);
      selectTool('select');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSlurSelection, clearTieSelection, editorMode, selectTool, setInsertionPreview]);

  useEffect(() => {
    const container = playback.containerRef.current;
    if (!container) return;

    const selectedDomainAnchor = editingSelection?.domainAnchor ?? null;
    const sourceIds = selectedDomainAnchor
      ? new Set(getRenderIdsForDomainAnchor(domainAnchors, selectedDomainAnchor))
      : null;
    const selectedColor = getDomainAnchorTrackColor(domainDocument, selectedDomainAnchor);

    const applySelection = () => {
      applySelectedVerovioElements({
        container,
        sourceIds,
        selectedColor,
      });
    };

    applySelection();
    const observer = new MutationObserver(() => applySelection());
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [currentXml, domainAnchors, domainDocument, editingSelection?.domainAnchor, playback.containerRef, playback.isLoading]);

  useEffect(() => {
    const container = playback.containerRef.current;
    if (!container || playback.isLoading) return;

    mountScoreMetadataPlaceholders({
      container,
      scoreData,
      labels: {
        mainTitle: t('mainTitleLabel'),
        subtitle: t('subtitleLabel'),
        lyricist: t('lyricistLabel'),
        composer: t('composerLabel'),
      },
    });
  }, [
    playback.containerRef,
    playback.isLoading,
    scoreData,
    scoreData?.composer,
    scoreData?.lyricist,
    scoreData?.mainTitle,
    scoreData?.subtitle,
    t,
  ]);

  useEffect(() => {
    const container = playback.containerRef.current;
    if (!container) return;

    container
      .querySelectorAll('.score-editor-hidden')
      .forEach((element) => element.classList.remove('score-editor-hidden'));

    if (hiddenSourceIds.size === 0 && hiddenStaffKeys.size === 0) return;

    const hiddenEventElements = new Set<Element>();
    const hiddenChordCandidates = new Set<Element>();
    const boundsBySourceId = new Map<string, SvgBounds[]>();
    container.querySelectorAll('[data-id], [id]').forEach((element) => {
      const id = element.getAttribute('data-id') || element.getAttribute('id');
      if (id) {
        addBounds(boundsBySourceId, id, getSvgBoundsFromGraphics(getHiddenVerovioEventElement(element)));
      }
      if (id && hiddenSourceIds.has(id)) {
        const hiddenElement = getHiddenVerovioEventElement(element);
        hiddenEventElements.add(hiddenElement);
        const chordElement = getVerovioChordElement(hiddenElement);
        if (chordElement) hiddenChordCandidates.add(chordElement);
      }
    });

    hiddenChordCandidates.forEach((chordElement) => {
      if (shouldHideWholeChord(chordElement, hiddenSourceIds)) {
        hiddenEventElements.add(chordElement);
      }
    });

    hiddenEventElements.forEach((element) => element.classList.add('score-editor-hidden'));

    container.querySelectorAll('[data-related]').forEach((element) => {
      if (getRelatedIds(element).some((id) => hiddenSourceIds.has(id))) {
        element.classList.add('score-editor-hidden');
      }
    });

    if (hiddenConnectionPairs.length > 0) {
      container.querySelectorAll(VEROVIO_CONNECTION_SELECTOR).forEach((element) => {
        if (element.classList.contains('score-editor-hidden')) return;

        const connectionBounds = getSvgBoundsFromGraphics(element);
        if (!connectionBounds) return;

        const shouldHideConnection = hiddenConnectionPairs.some((pair) => {
          const startBounds = boundsBySourceId.get(pair.startId) ?? [];
          const endBounds = boundsBySourceId.get(pair.endId) ?? [];
          const bothEndpointsMatch = startBounds.some((start) => (
            endBounds.some((end) => isConnectionNearEndpointPair(connectionBounds, start, end))
          ));
          if (bothEndpointsMatch) return true;

          const hiddenEndpointBounds = [
            ...(hiddenSourceIds.has(pair.startId) ? startBounds : []),
            ...(hiddenSourceIds.has(pair.endId) ? endBounds : []),
          ];

          return isConnectionNearAnyEndpoint(connectionBounds, hiddenEndpointBounds);
        });

        if (shouldHideConnection) {
          element.classList.add('score-editor-hidden');
        }
      });
    }

    container.querySelectorAll('[data-class="measure"], .measure').forEach((measureElement, measureIndex) => {
      scoreData?.measures[measureIndex]?.staves.forEach((_, staveIndex) => {
        if (!hiddenStaffKeys.has(`${measureIndex}:${staveIndex}`)) return;

        const staffElement = getVerovioStaffElementForIndex(measureElement, staveIndex);
        const scopedConnections = staffElement
          ? Array.from(staffElement.querySelectorAll(VEROVIO_CONNECTION_SELECTOR))
          : [];
        const connections = scopedConnections.length > 0
          ? scopedConnections
          : Array.from(measureElement.querySelectorAll(VEROVIO_CONNECTION_SELECTOR))
            .filter((element) => {
              const staffBounds = staffElement ? getSvgBoundsFromGraphics(staffElement) : null;
              const connectionBounds = getSvgBoundsFromGraphics(element);
              return Boolean(staffBounds && connectionBounds && isConnectionNearHiddenEvent(connectionBounds, staffBounds));
            });

        connections.forEach((element) => element.classList.add('score-editor-hidden'));
      });
    });
  }, [
    currentXml,
    hiddenConnectionPairs,
    hiddenSourceIds,
    hiddenStaffKeys,
    playback.containerRef,
    playback.isLoading,
    scoreData?.measures,
  ]);

  const handleScoreClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (isScoreMetadataTarget(event.currentTarget, event.target, event.clientY)) {
      event.preventDefault();
      event.stopPropagation();
      handleCloseModal();
      onOpenScoreInspector();
      return;
    }

    const renderElementId = getVerovioRenderElementIdFromTarget(event.target);
    const domainAnchor = resolveDomainAnchor(renderElementId);
    setLastDomainAnchorKind(domainAnchor?.kind ?? null);
    const measureElement = getVerovioMeasureElementFromTarget(event.target)
      ?? getMeasureElementFromPoint(event.currentTarget, event.clientX, event.clientY);
    const measureIndex = getMeasureIndex(event.currentTarget, measureElement)
      ?? getVerovioMeasureIndexFromTarget(event.currentTarget, event.target);
    if (!domainAnchor && measureIndex === null) return;

    event.preventDefault();
    event.stopPropagation();

    if (editorMode === 'add') {
      if (measureIndex === null || !measureElement) return;

      const target = getInsertTarget(event, measureElement, 0, 1);
      const placement = resolveRhythmicInsertPlacement({
        domainDocument,
        timelineGaps: domainGaps,
        scoreData,
        measureElement,
        measureIndex,
        target,
        clientX: event.clientX,
        divisions,
        inputDuration: addModeInputDuration,
        grid: addModeGridResolution,
        timeSignature: scoreData?.timeSignature,
        visibleTrackIdSet,
      });
      if (!placement) return;
      const location = placement.location;
      const previewInput = resolvePointerAddModePreviewInput(
        event,
        measureElement,
        measureIndex,
        target.staveIndex,
        placement.left
      );
      const command = createAddModeInsertCommand({
        input: previewInput.input,
        inputDuration: addModeInputDuration,
      });
      setInsertionPreview({
        anchor: placement.insertionAnchor,
        inputDuration: addModeInputDuration,
      });

      if (isMobile && !isSameAddLocation(addModePreview?.location ?? null, location)) {
        const targetElement = getInsertVerticalAnchor(measureElement, location.staveIndex) ?? measureElement;
        setAddModePreview({
          command,
          gridMarkerStyles: getGridMarkerStyles(event, targetElement, placement.gridLines),
          ghostNoteheadKind: getGhostNoteheadKind(addModeInputDuration),
          insertionAnchor: placement.insertionAnchor,
          location,
          ledgerLineStyles: previewInput.ledgerLineStyles,
          pitchStyle: previewInput.pitchStyle,
          style: getCaretStyle(event, targetElement, placement.left),
        });
        return;
      }

      setAddModePreview(null);
      handleAddEntity(placement.insertionAnchor, command);
      setInsertionPreview(null);
      return;
    }

    const domainCompanion = createDomainSelectionCompanion(domainDocument, domainAnchor);
    setLastDomainCompanionKind(domainCompanion?.inspectorViewModel.kind ?? null);

    if (editorMode === 'delete') {
      handleDeleteEntity(domainAnchor);
      return;
    }

    const runConnectionTool = (
      type: 'tie' | 'slur',
      operation: (target: ConnectionTarget) => { success: boolean; message: string }
    ) => {
      const target = resolvePitchedConnectionTarget(domainDocument, domainAnchor, domainAnchors);
      if (!target) {
        toast({
          title: t('onlyNoteOrChord', { type: common(type) }),
          variant: 'destructive',
        });
        return;
      }

      const result = operation(target);
      toast({ title: result.message, variant: result.success ? 'default' : 'destructive' });
    };

    if (editorMode === 'addTie') {
      runConnectionTool('tie', handleAddTieSelection);
      return;
    }

    if (editorMode === 'addSlur') {
      runConnectionTool('slur', handleAddSlurSelection);
      return;
    }

    if (editorMode === 'deleteTie') {
      runConnectionTool('tie', handleDeleteTie);
      return;
    }

    if (editorMode === 'deleteSlur') {
      runConnectionTool('slur', handleDeleteSlur);
      return;
    }

    if (!domainCompanion) return;

    handleDomainSelectionCompanion(domainCompanion);
  }, [
    addModeInputDuration,
    addModeGridResolution,
    divisions,
    editorMode,
    handleAddEntity,
    handleAddSlurSelection,
    handleAddTieSelection,
    handleCloseModal,
    handleDeleteEntity,
    handleDeleteSlur,
    handleDeleteTie,
    handleDomainSelectionCompanion,
    getInsertTarget,
    resolvePointerAddModePreviewInput,
    addModePreview?.location,
    isMobile,
    onOpenScoreInspector,
    scoreData,
    toast,
    t,
    common,
    visibleTrackIdSet,
    domainDocument,
    domainGaps,
    domainAnchors,
    resolveDomainAnchor,
    setInsertionPreview,
  ]);

  const handleScoreMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (editorMode !== 'add') {
      if (addModePreview) setAddModePreview(null);
      setInsertionPreview(null);
      return;
    }

    const renderElementId = getVerovioRenderElementIdFromTarget(event.target);
    const domainAnchor = resolveDomainAnchor(renderElementId);
    setLastDomainAnchorKind(domainAnchor?.kind ?? null);
    const measureElement = getVerovioMeasureElementFromTarget(event.target)
      ?? getMeasureElementFromPoint(event.currentTarget, event.clientX, event.clientY);
    const measureIndex = getMeasureIndex(event.currentTarget, measureElement)
      ?? getVerovioMeasureIndexFromTarget(event.currentTarget, event.target);

    if (!measureElement || measureIndex === null) {
      setAddModePreview(null);
      setInsertionPreview(null);
      return;
    }

    const target = getInsertTarget(event, measureElement, 0, 1);
    const placement = resolveRhythmicInsertPlacement({
      domainDocument,
      timelineGaps: domainGaps,
      scoreData,
      measureElement,
      measureIndex,
      target,
      clientX: event.clientX,
      divisions,
      inputDuration: addModeInputDuration,
      grid: addModeGridResolution,
      timeSignature: scoreData?.timeSignature,
      visibleTrackIdSet,
    });
    if (!placement) {
      setAddModePreview(null);
      setInsertionPreview(null);
      return;
    }
    const previewInput = resolvePointerAddModePreviewInput(
      event,
      measureElement,
      measureIndex,
      target.staveIndex,
      placement.left
    );
    setInsertionPreview({
      anchor: placement.insertionAnchor,
      inputDuration: addModeInputDuration,
    });

    setAddModePreview({
      command: createAddModeInsertCommand({
        input: previewInput.input,
        inputDuration: addModeInputDuration,
      }),
      gridMarkerStyles: getGridMarkerStyles(
        event,
        getInsertVerticalAnchor(measureElement, target.staveIndex) ?? measureElement,
        placement.gridLines
      ),
      ghostNoteheadKind: getGhostNoteheadKind(addModeInputDuration),
      insertionAnchor: placement.insertionAnchor,
      location: placement.location,
      ledgerLineStyles: previewInput.ledgerLineStyles,
      pitchStyle: previewInput.pitchStyle,
      style: getCaretStyle(
        event,
        getInsertVerticalAnchor(measureElement, target.staveIndex) ?? measureElement,
        placement.left
      ),
    });
  }, [
    addModeInputDuration,
    addModeGridResolution,
    divisions,
    domainDocument,
    domainGaps,
    editorMode,
    getInsertTarget,
    resolvePointerAddModePreviewInput,
    addModePreview,
    resolveDomainAnchor,
    scoreData,
    setInsertionPreview,
    visibleTrackIdSet,
  ]);

  const handleScoreMouseLeave = useCallback(() => {
    if (!isMobile) {
      setAddModePreview(null);
      setInsertionPreview(null);
    }
  }, [isMobile, setInsertionPreview]);

  const confirmMobileInsert = useCallback(() => {
    if (!addModePreview?.location) return;
    const insertionAnchor = addModePreview.insertionAnchor;
    const command = addModePreview.command;
    setAddModePreview(null);
    setInsertionPreview(null);
    handleAddEntity(insertionAnchor, command);
  }, [addModePreview, handleAddEntity, setInsertionPreview]);

  return (
    <div
      className="relative flex min-h-[70vh] min-w-0 flex-col gap-4"
      data-domain-anchor-count={domainAnchors.length}
      data-domain-anchor-error={domainAnchorError ? 'true' : undefined}
      data-domain-anchor-kind={lastDomainAnchorKind ?? undefined}
      data-domain-companion-kind={lastDomainCompanionKind ?? undefined}
      data-insertion-preview-kind={insertionPreview?.anchor.kind}
    >
      <ScorePreviewViewport
        className="min-h-[62vh] rounded-lg border bg-white p-4 shadow-sm"
        containerRef={playback.containerRef}
        isLoading={playback.isLoading && !playback.hasRenderedScore}
        loadError={playback.loadError}
        onScoreClick={handleScoreClick}
        onScoreMouseLeave={handleScoreMouseLeave}
        onScoreMouseMove={handleScoreMouseMove}
        scoreContainerRef={playback.scoreContainerRef}
      />
      {addModePreview?.gridMarkerStyles.map((style, index) => (
        <div
          key={`grid-${index}`}
          aria-hidden="true"
          className="pointer-events-none absolute z-20 w-0.5 rounded-full bg-orange-500"
          data-testid="add-mode-grid-marker"
          style={style}
        />
      ))}
      {addModePreview ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 w-0.5 rounded-full"
          style={{
            ...addModePreview.style,
            ...getCaretColorStyle(activeTrack?.color),
          }}
        />
      ) : null}
      {addModePreview?.pitchStyle ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-20 rounded-[999px] border-2 opacity-35"
          data-testid="add-mode-ghost-note"
          style={{
            ...addModePreview.pitchStyle,
            ...getGhostNoteheadColorStyle(activeTrack?.color, addModePreview.ghostNoteheadKind),
            transform: 'rotate(-18deg)',
          }}
        />
      ) : null}
      {addModePreview?.ledgerLineStyles?.map((style, index) => (
        <div
          key={`ledger-${index}`}
          aria-hidden="true"
          className="pointer-events-none absolute z-10 h-0.5 rounded-full opacity-45"
          data-testid="add-mode-ghost-ledger-line"
          style={{
            ...style,
            ...getGhostNoteColorStyle(activeTrack?.color),
          }}
        />
      ))}
      {isMobile && editorMode === 'add' && addModePreview?.location ? (
        <div className="fixed inset-x-4 bottom-4 z-30 flex items-center gap-2 rounded-lg border bg-white/95 p-2 shadow-lg backdrop-blur-sm md:hidden">
          <Button type="button" className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={confirmMobileInsert}>
            {t('insertHere')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setAddModePreview(null)}>
            {common('cancel')}
          </Button>
        </div>
      ) : null}

      <EditorBottomPlayer
        currentTime={playback.currentTime}
        isLoading={playback.isLoading}
        isLooping={playback.isLooping}
        isPlaying={playback.isPlaying}
        progress={playback.progress}
        totalTime={playback.totalTime}
        onPlayPause={playback.playPause}
        onSeek={playback.seek}
        onSeekEnd={playback.seekEnd}
        onSeekStart={playback.seekStart}
        onStop={playback.stop}
        onToggleLoop={playback.toggleLoop}
      />
    </div>
  );
}
