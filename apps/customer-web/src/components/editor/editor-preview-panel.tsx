'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ScorePreviewViewport } from '@/components/score-preview/score-preview-viewport';
import { Button } from '@/components/ui/button';
import { useEditorState, useScoreData, useXmlUpdater } from '@/contexts/editor-provider';
import { useScorePreviewPlayback } from '@/hooks/score-preview/use-score-preview-playback';
import { useMeasureWarningOverlay } from '@/hooks/score/use-measure-warning-overlay';
import { useEntityEditor } from '@/hooks/editor/use-entity-editor';
import { useConnectionOperations } from '@/hooks/editor/use-connection-operations';
import { useEditorTracks } from '@/hooks/editor/use-editor-tracks';
import { useIsMobile } from '@/hooks/use-mobile';
import { useToast } from '@/hooks/use-toast';
import { getDivisions, parseXml } from '@/lib/musicxml/core';
import {
  findScoreEntityById,
  getVerovioElementIdFromTarget,
  getVerovioMeasureElementFromTarget,
  getVerovioMeasureIndexFromTarget,
  getVerovioStaffElementForIndex,
} from '@/lib/editor/verovio-entity-map';
import { getEntityDurationTicks, snapMeasureXToGridTick } from '@/lib/editor/measure-timeline';
import { validateDataIntegrity } from '@/lib/musicxml/validator';
import { getEditorTrackId, getTrackColor, parseVoiceNumber } from '@/lib/editor/tracks';
import { EditorBottomPlayer } from './editor-bottom-player';
import type { AddLocation, ScoreData, ScoreEntity } from '@/types/score-types';

interface EditorPreviewPanelProps {
  active: boolean;
  currentXml: string | null;
  onOpenScoreInspector: () => void;
}

type InsertPreview = {
  location: AddLocation | null;
  style: CSSProperties;
};

type SvgBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type InsertTarget = {
  staveIndex: number;
  xmlVoice: number;
};

type InsertPlacement = {
  left: number;
  tick: number;
};

type VisualAnchor = {
  tick: number;
  endTick: number;
  left: number;
  right: number;
};

type ConnectionEndpointPair = {
  startId: string;
  endId: string;
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
  '[data-class="space"]',
].join(', ');
const VEROVIO_MEASURE_SELECTOR = '[data-class="measure"], .measure';
const VEROVIO_STAFF_SELECTOR = '[data-class="staff"], .staff';

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

function getMeasureGridSnap(
  event: MouseEvent<HTMLDivElement>,
  measureElement: Element,
  timeSignature: string | undefined,
  divisions: number
) {
  const measureRect = getMeasureHorizontalBounds(measureElement);
  const snap = snapMeasureXToGridTick({
    clientX: event.clientX,
    measureLeft: measureRect.left,
    measureWidth: measureRect.width,
    timeSignature,
    divisions,
  });

  return {
    ...snap,
    left: measureRect.left + snap.ratio * measureRect.width,
  };
}

function getMeasureHorizontalBounds(measureElement: Element) {
  const staffRects = getDirectStaffElements(measureElement)
    .map((staff) => staff.getBoundingClientRect())
    .filter((rect) => rect.width > 0);
  if (staffRects.length === 0) return measureElement.getBoundingClientRect();

  const left = Math.min(...staffRects.map((rect) => rect.left));
  const right = Math.max(...staffRects.map((rect) => rect.right));
  return { left, right, width: Math.max(1, right - left) };
}

function getDirectStaffElements(measureElement: Element | null): Element[] {
  if (!measureElement) return [];

  return Array.from(measureElement.querySelectorAll(VEROVIO_STAFF_SELECTOR))
    .filter((staff) => staff.closest(VEROVIO_MEASURE_SELECTOR) === measureElement);
}

function getDirectMeasureElements(container: Element | null): Element[] {
  if (!container) return [];

  return Array.from(container.querySelectorAll(VEROVIO_MEASURE_SELECTOR))
    .filter((measure) => measure.closest(VEROVIO_MEASURE_SELECTOR) === measure);
}

function getMeasureElementFromPoint(container: Element | null, clientX: number, clientY: number): Element | null {
  const measures = getDirectMeasureElements(container);
  const tolerance = 8;
  let nearestMeasure: Element | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  measures.forEach((measure) => {
    const rect = measure.getBoundingClientRect();
    const horizontal = getMeasureHorizontalBounds(measure);
    const containsPoint = clientX >= horizontal.left - tolerance
      && clientX <= horizontal.right + tolerance
      && clientY >= rect.top - tolerance
      && clientY <= rect.bottom + tolerance;
    if (!containsPoint) return;

    const centerX = horizontal.left + horizontal.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    if (distance < nearestDistance) {
      nearestMeasure = measure;
      nearestDistance = distance;
    }
  });

  return nearestMeasure;
}

function getMeasureIndex(container: Element | null, measureElement: Element | null): number | null {
  if (!container || !measureElement) return null;
  const measures = getDirectMeasureElements(container);
  const index = measures.indexOf(measureElement);
  return index >= 0 ? index : null;
}

function getStaveIndexFromPointer(measureElement: Element | null, clientY: number): number | null {
  const staves = getDirectStaffElements(measureElement);
  if (staves.length === 0) return null;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  staves.forEach((staff, index) => {
    const rect = staff.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(clientY - centerY);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });

  return nearestIndex;
}

function getInsertVerticalAnchor(measureElement: Element | null, staveIndex: number): Element | null {
  return getVerovioStaffElementForIndex(measureElement, staveIndex) ?? measureElement;
}

function getTargetVoiceHasEvents(
  scoreData: ScoreData | null,
  measureIndex: number,
  staveIndex: number,
  xmlVoice: number
): boolean {
  const voice = scoreData?.measures[measureIndex]?.staves[staveIndex]?.voices.find((candidate) => (
    parseVoiceNumber(candidate.name) === xmlVoice
  ));

  return Boolean(voice && voice.notes.length > 0);
}

function getTargetStaffHasEvents(
  scoreData: ScoreData | null,
  measureIndex: number,
  staveIndex: number
): boolean {
  const stave = scoreData?.measures[measureIndex]?.staves[staveIndex];
  return Boolean(stave?.voices.some((voice) => voice.notes.length > 0));
}

function getStaffVoiceNumbersWithEvents(
  scoreData: ScoreData | null,
  measureIndex: number,
  staveIndex: number,
  visibleTrackIdSet: Set<string>
): number[] {
  const stave = scoreData?.measures[measureIndex]?.staves[staveIndex];
  if (!stave) return [];

  return stave.voices
    .filter((voice) => voice.notes.length > 0)
    .map((voice) => parseVoiceNumber(voice.name))
    .filter((xmlVoice) => visibleTrackIdSet.has(getEditorTrackId(staveIndex, xmlVoice)));
}

function getEntityElementBounds(measureElement: Element, entity: ScoreEntity): { left: number; right: number } | null {
  const ids = new Set(entity.meta?.sourceIds?.length ? entity.meta.sourceIds : entity.meta?.id ? [entity.meta.id] : []);
  if (ids.size === 0) return null;

  const element = Array.from(measureElement.querySelectorAll('[data-id], [id]')).find((candidate) => {
    const id = candidate.getAttribute('data-id') || candidate.getAttribute('id');
    return Boolean(id && ids.has(id));
  });
  if (!element) return null;

  const renderedElement = getHiddenVerovioEventElement(element);
  const notehead = element.matches('[data-class="note"]')
    ? element.querySelector(':scope > [data-class="notehead"]')
    : renderedElement.querySelector('[data-class="notehead"]');
  const rect = (notehead ?? renderedElement).getBoundingClientRect();
  if (notehead) {
    const center = rect.left + rect.width / 2;
    // A notehead center is the stable rhythmic anchor. Stems, beams, dots,
    // and accidentals must not move insertion slots horizontally.
    return { left: center, right: center };
  }
  return { left: rect.left, right: rect.right };
}

function getVisualInsertPlacement(params: {
  scoreData: ScoreData | null;
  measureElement: Element;
  measureIndex: number;
  target: InsertTarget;
  clientX: number;
  divisions: number;
  visibleTrackIdSet: Set<string>;
}): InsertPlacement | null {
  const {
    scoreData,
    measureElement,
    measureIndex,
    target,
    clientX,
    divisions,
    visibleTrackIdSet,
  } = params;
  const targetVoiceHasEvents = getTargetVoiceHasEvents(
    scoreData,
    measureIndex,
    target.staveIndex,
    target.xmlVoice
  );
  const borrowedVoices = targetVoiceHasEvents
    ? [target.xmlVoice]
    : getStaffVoiceNumbersWithEvents(scoreData, measureIndex, target.staveIndex, visibleTrackIdSet);
  const voiceSet = new Set(borrowedVoices);
  if (voiceSet.size === 0) return null;

  const anchors = new Map<number, { leftValues: number[]; rightValues: number[]; endTick: number }>();
  const stave = scoreData?.measures[measureIndex]?.staves[target.staveIndex];
  stave?.voices.forEach((voice) => {
    const xmlVoice = parseVoiceNumber(voice.name);
    if (!voiceSet.has(xmlVoice)) return;

    voice.notes.forEach((entity) => {
      if (!entity.meta) return;
      const bounds = getEntityElementBounds(measureElement, entity);
      if (bounds === null) return;

      const startTick = entity.meta.startTick ?? 0;
      const endTick = startTick + getEntityDurationTicks(entity, divisions);
      const anchor = anchors.get(startTick) ?? { leftValues: [], rightValues: [], endTick };
      anchor.leftValues.push(bounds.left);
      anchor.rightValues.push(bounds.right);
      anchor.endTick = Math.max(anchor.endTick, endTick);
      anchors.set(startTick, anchor);
    });
  });

  const visualAnchors: VisualAnchor[] = Array.from(anchors.entries())
    .map(([tick, anchor]) => ({
      tick,
      endTick: anchor.endTick,
      left: anchor.leftValues.reduce((sum, value) => sum + value, 0) / anchor.leftValues.length,
      right: anchor.rightValues.reduce((sum, value) => sum + value, 0) / anchor.rightValues.length,
    }))
    .filter((anchor) => Number.isFinite(anchor.left) && Number.isFinite(anchor.right))
    .sort((left, right) => left.left - right.left);

  if (visualAnchors.length === 0) return null;

  const measureRect = getMeasureHorizontalBounds(measureElement);
  const placements: InsertPlacement[] = [];
  const first = visualAnchors[0];
  const last = visualAnchors[visualAnchors.length - 1];

  placements.push({
    left: (measureRect.left + first.left) / 2,
    tick: first.tick,
  });

  for (let index = 0; index < visualAnchors.length - 1; index++) {
    const current = visualAnchors[index];
    const next = visualAnchors[index + 1];
    if (Math.abs(next.left - current.right) <= 2) continue;
    placements.push({
      left: (current.right + next.left) / 2,
      tick: next.tick,
    });
  }

  placements.push({
    left: (last.right + measureRect.right) / 2,
    tick: last.endTick,
  });

  return placements.reduce((nearest, placement) => (
    Math.abs(placement.left - clientX) < Math.abs(nearest.left - clientX)
      ? placement
      : nearest
  ), placements[0]);
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

function getConnectionSourceId(entity: ScoreEntity, elementId: string | null) {
  if (!elementId) return undefined;
  return entity.meta?.sourceIds?.includes(elementId) ? elementId : undefined;
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

export function EditorPreviewPanel({ active, currentXml, onOpenScoreInspector }: EditorPreviewPanelProps) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const { scoreData } = useScoreData();
  const { editingEntity, editorMode, selectTool, setOnToolChange } = useEditorState();
  const { tracks, activeTrackId, visibleTrackIdSet } = useEditorTracks();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const { updateMusicXML } = useXmlUpdater();
  const { handleAddEntity, handleCloseModal, handleDeleteEntity, handleEditEntity } = useEntityEditor();
  const {
    handleAddSlurSelection,
    handleAddTieSelection,
    clearSlurSelection,
    clearTieSelection,
    handleDeleteSlur,
    handleDeleteTie,
  } = useConnectionOperations({ scoreData, currentXml, updateMusicXML });
  const [insertPreview, setInsertPreview] = useState<InsertPreview | null>(null);
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
    const ids = new Set<string>();
    if (!scoreData) return ids;

    scoreData.measures.forEach((measure) => {
      measure.staves.forEach((stave, staveIndex) => {
        stave.voices.forEach((voice) => {
          const xmlVoice = Number.parseInt(voice.name.match(/\d+/)?.[0] ?? '1', 10);
          const trackId = getEditorTrackId(staveIndex, xmlVoice);
          if (visibleTrackIdSet.has(trackId)) return;

          voice.notes.forEach((entity) => {
            const sourceIds = entity.meta?.sourceIds || (entity.meta?.id ? [entity.meta.id] : []);
            sourceIds.forEach((id) => ids.add(id));
          });
        });
      });
    });

    return ids;
  }, [scoreData, visibleTrackIdSet]);
  const hiddenConnectionPairs = useMemo(() => {
    const pairs: ConnectionEndpointPair[] = [];
    const noteConnections = scoreData?.connections?.noteConnections;
    if (!noteConnections || hiddenSourceIds.size === 0) return pairs;

    noteConnections.forEach((connections, entityId) => {
      connections.ties.forEach((tie) => {
        const startId = tie.sourceId ?? entityId;
        const endId = tie.partnerSourceId ?? tie.partnerId;
        if (hiddenSourceIds.has(startId) || hiddenSourceIds.has(endId)) {
          pairs.push({ startId, endId });
        }
      });

      connections.slurs.forEach((slur) => {
        const startId = slur.sourceId ?? entityId;
        const partnerSourceIds = slur.partnerSourceIds?.length ? slur.partnerSourceIds : slur.partnerIds;
        partnerSourceIds.forEach((partnerId) => {
          if (partnerId === startId) return;
          if (hiddenSourceIds.has(startId) || hiddenSourceIds.has(partnerId)) {
            pairs.push({ startId, endId: partnerId });
          }
        });
      });
    });

    return pairs;
  }, [hiddenSourceIds, scoreData?.connections?.noteConnections]);
  const hiddenStaffKeys = useMemo(() => {
    const keys = new Set<string>();
    if (!scoreData) return keys;

    scoreData.measures.forEach((measure, measureIndex) => {
      measure.staves.forEach((stave, staveIndex) => {
        const voicesWithEntities = stave.voices.filter((voice) => voice.notes.length > 0);
        if (voicesWithEntities.length === 0) return;

        const allEntityVoicesHidden = voicesWithEntities.every((voice) => {
          const xmlVoice = Number.parseInt(voice.name.match(/\d+/)?.[0] ?? '1', 10);
          const trackId = getEditorTrackId(staveIndex, xmlVoice);
          return !visibleTrackIdSet.has(trackId);
        });

        if (allEntityVoicesHidden) {
          keys.add(`${measureIndex}:${staveIndex}`);
        }
      });
    });

    return keys;
  }, [scoreData, visibleTrackIdSet]);

  useEffect(() => {
    setOnToolChange(() => {
      clearTieSelection();
      clearSlurSelection();
      setInsertPreview(null);
    });

    return () => setOnToolChange(null);
  }, [clearSlurSelection, clearTieSelection, setOnToolChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isEditableTarget(event.target)) return;
      if (!['add', 'delete', 'addTie', 'deleteTie', 'addSlur', 'deleteSlur'].includes(editorMode)) return;

      clearTieSelection();
      clearSlurSelection();
      setInsertPreview(null);
      selectTool('select');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [clearSlurSelection, clearTieSelection, editorMode, selectTool]);

  useEffect(() => {
    const container = playback.containerRef.current;
    if (!container) return;

    const sourceIds = editingEntity?.meta
      ? new Set(editingEntity.meta.sourceIds || [editingEntity.meta.id])
      : null;
    const selectedColor = editingEntity?.meta
      ? getTrackColor(editingEntity.meta.staveIndex, editingEntity.meta.xmlVoice)
      : undefined;

    const applySelection = () => {
      container
        .querySelectorAll('.score-editor-selected')
        .forEach((element) => {
          element.classList.remove('score-editor-selected');
          if (element instanceof HTMLElement || element instanceof SVGElement) {
            element.style.removeProperty('--score-editor-selection-color');
          }
        });

      if (!sourceIds) return;
      container.querySelectorAll('[data-id], [id]').forEach((element) => {
        const id = element.getAttribute('data-id') || element.getAttribute('id');
        if (id && sourceIds.has(id)) {
          element.classList.add('score-editor-selected');
          if (selectedColor && (element instanceof HTMLElement || element instanceof SVGElement)) {
            element.style.setProperty('--score-editor-selection-color', selectedColor);
          }
        }
      });
    };

    applySelection();
    const observer = new MutationObserver(() => applySelection());
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [currentXml, editingEntity, playback.containerRef, playback.isLoading]);

  useEffect(() => {
    const container = playback.containerRef.current;
    if (!container || playback.isLoading) return;

    container.querySelectorAll('[data-score-metadata-placeholder]').forEach((element) => element.remove());

    const page = container.querySelector<HTMLElement>('[data-score-page="1"]')
      ?? container.querySelector<HTMLElement>('[data-score-page]');
    if (!page || !scoreData) return;

    const placeholders = [
      !scoreData.mainTitle ? { className: 'score-metadata-placeholder-title', label: t('mainTitleLabel') } : null,
      !scoreData.subtitle ? { className: 'score-metadata-placeholder-subtitle', label: t('subtitleLabel') } : null,
      !scoreData.lyricist ? { className: 'score-metadata-placeholder-lyricist', label: t('lyricistLabel') } : null,
      !scoreData.composer ? { className: 'score-metadata-placeholder-composer', label: t('composerLabel') } : null,
    ].filter((placeholder): placeholder is { className: string; label: string } => Boolean(placeholder));

    if (placeholders.length === 0) return;

    placeholders.forEach((placeholder) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.dataset.scoreMetadataPlaceholder = 'true';
      element.className = `score-metadata-placeholder ${placeholder.className}`;
      element.textContent = placeholder.label;
      page.append(element);
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

    const entityId = getVerovioElementIdFromTarget(event.target);
    const hit = findScoreEntityById(scoreData, entityId);
    const measureElement = getVerovioMeasureElementFromTarget(event.target)
      ?? getMeasureElementFromPoint(event.currentTarget, event.clientX, event.clientY);
    const measureIndex = getMeasureIndex(event.currentTarget, measureElement)
      ?? getVerovioMeasureIndexFromTarget(event.currentTarget, event.target);
    if (!hit && measureIndex === null) return;

    event.preventDefault();
    event.stopPropagation();

    if (editorMode === 'add') {
      const insertMeasureIndex = hit?.location.measureIndex ?? measureIndex;
      if (insertMeasureIndex === null || !measureElement) return;

      const target = getInsertTarget(event, measureElement, hit?.location.staveIndex ?? 0, hit?.location.xmlVoice ?? 1);
      const visualPlacement = getVisualInsertPlacement({
        scoreData,
        measureElement,
        measureIndex: insertMeasureIndex,
        target,
        clientX: event.clientX,
        divisions,
        visibleTrackIdSet,
      });
      const hasTimingAnchors = Boolean(visualPlacement)
        || getTargetStaffHasEvents(scoreData, insertMeasureIndex, target.staveIndex);
      const snap = getMeasureGridSnap(event, measureElement, scoreData?.timeSignature, divisions);
      const placement = visualPlacement
        ?? (hasTimingAnchors
          ? { left: snap.left, tick: snap.tick }
          : { left: measureElement.getBoundingClientRect().left, tick: 0 });
      const location = {
        measureIndex: insertMeasureIndex,
        staveIndex: target.staveIndex,
        xmlVoice: target.xmlVoice,
        tick: placement.tick,
      };

      if (isMobile && !isSameAddLocation(insertPreview?.location ?? null, location)) {
        const targetElement = getInsertVerticalAnchor(measureElement, location.staveIndex) ?? measureElement;
        setInsertPreview({
          location,
          style: getCaretStyle(event, targetElement, placement.left),
        });
        return;
      }

      setInsertPreview(null);
      handleAddEntity(location);
      return;
    }

    if (!hit) return;

    if (editorMode === 'delete') {
      handleDeleteEntity(hit.location);
      return;
    }

    if (editorMode === 'addTie') {
      const result = handleAddTieSelection(hit.location, hit.entity, getConnectionSourceId(hit.entity, entityId));
      toast({ title: result.message, variant: result.success ? 'default' : 'destructive' });
      return;
    }

    if (editorMode === 'addSlur') {
      const result = handleAddSlurSelection(hit.location, hit.entity, getConnectionSourceId(hit.entity, entityId));
      toast({ title: result.message, variant: result.success ? 'default' : 'destructive' });
      return;
    }

    if (editorMode === 'deleteTie') {
      const result = handleDeleteTie(hit.entity);
      toast({ title: result.message, variant: result.success ? 'default' : 'destructive' });
      return;
    }

    if (editorMode === 'deleteSlur') {
      const result = handleDeleteSlur(hit.entity);
      toast({ title: result.message, variant: result.success ? 'default' : 'destructive' });
      return;
    }

    handleEditEntity(hit.entity, hit.location);
  }, [
    divisions,
    editorMode,
    handleAddEntity,
    handleAddSlurSelection,
    handleAddTieSelection,
    handleCloseModal,
    handleDeleteEntity,
    handleDeleteSlur,
    handleDeleteTie,
    handleEditEntity,
    getInsertTarget,
    insertPreview?.location,
    isMobile,
    onOpenScoreInspector,
    scoreData,
    toast,
    visibleTrackIdSet,
  ]);

  const handleScoreMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (editorMode !== 'add') {
      if (insertPreview) setInsertPreview(null);
      return;
    }

    const entityId = getVerovioElementIdFromTarget(event.target);
    const hit = findScoreEntityById(scoreData, entityId);
    const measureElement = getVerovioMeasureElementFromTarget(event.target)
      ?? getMeasureElementFromPoint(event.currentTarget, event.clientX, event.clientY);
    const measureIndex = getMeasureIndex(event.currentTarget, measureElement)
      ?? getVerovioMeasureIndexFromTarget(event.currentTarget, event.target);

    const insertMeasureIndex = hit?.location.measureIndex ?? measureIndex;
    if (!measureElement || insertMeasureIndex === null) {
      setInsertPreview(null);
      return;
    }

    const target = getInsertTarget(event, measureElement, hit?.location.staveIndex ?? 0, hit?.location.xmlVoice ?? 1);
    const visualPlacement = getVisualInsertPlacement({
      scoreData,
      measureElement,
      measureIndex: insertMeasureIndex,
      target,
      clientX: event.clientX,
      divisions,
      visibleTrackIdSet,
    });
    const hasTimingAnchors = Boolean(visualPlacement)
      || getTargetStaffHasEvents(scoreData, insertMeasureIndex, target.staveIndex);
    const snap = getMeasureGridSnap(event, measureElement, scoreData?.timeSignature, divisions);
    const placement = visualPlacement
      ?? (hasTimingAnchors
        ? { left: snap.left, tick: snap.tick }
        : { left: measureElement.getBoundingClientRect().left, tick: 0 });

    setInsertPreview({
      location: {
        measureIndex: insertMeasureIndex,
        staveIndex: target.staveIndex,
        xmlVoice: target.xmlVoice,
        tick: placement.tick,
      },
      style: getCaretStyle(
        event,
        getInsertVerticalAnchor(measureElement, target.staveIndex) ?? measureElement,
        placement.left
      ),
    });
  }, [divisions, editorMode, getInsertTarget, insertPreview, scoreData, visibleTrackIdSet]);

  const handleScoreMouseLeave = useCallback(() => {
    if (!isMobile) setInsertPreview(null);
  }, [isMobile]);

  const confirmMobileInsert = useCallback(() => {
    if (!insertPreview?.location) return;
    const location = insertPreview.location;
    setInsertPreview(null);
    handleAddEntity(location);
  }, [handleAddEntity, insertPreview]);

  return (
    <div className="relative flex min-h-[70vh] min-w-0 flex-col gap-4">
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
      {insertPreview ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 w-0.5 rounded-full"
          style={{
            ...insertPreview.style,
            ...getCaretColorStyle(activeTrack?.color),
          }}
        />
      ) : null}
      {isMobile && editorMode === 'add' && insertPreview?.location ? (
        <div className="fixed inset-x-4 bottom-4 z-30 flex items-center gap-2 rounded-lg border bg-white/95 p-2 shadow-lg backdrop-blur-sm md:hidden">
          <Button type="button" className="flex-1 bg-blue-600 hover:bg-blue-700" onClick={confirmMobileInsert}>
            {t('insertHere')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setInsertPreview(null)}>
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
