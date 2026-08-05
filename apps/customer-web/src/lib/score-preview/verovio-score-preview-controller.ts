'use client';

import type {
  CursorSyncOptions,
  CursorVisibilityOptions,
  ScorePlaybackSnapshot,
  ScorePlaybackState,
  ScorePreviewController,
} from './contracts';
import { VerovioScoreAdapter } from '@/lib/score/verovio';
import {
  SoundfontAudioEngine,
  VerovioPlaybackPrototype,
  type VerovioAudioEngine,
  type VerovioPlaybackCursorSnapshot,
} from '@/lib/score/verovio/playback';

type VerovioScorePreviewControllerOptions = {
  container: HTMLElement;
  bpm?: number;
  adapter?: VerovioScoreAdapter;
  audioEngine?: VerovioAudioEngine;
  toolkitOptions?: Record<string, unknown>;
  fitToContainerOptions?: (pageWidth: number) => Record<string, unknown>;
};

type CursorPlacementOptions = CursorSyncOptions & {
  alignToMeasureStart?: boolean;
  alignBeforeFirstEventToMeasureStart?: boolean;
  keepCurrentBeforeFirstEvent?: boolean;
};

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function findScrollableAncestor(element: HTMLElement) {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    const canScrollY = /(auto|scroll)/.test(style.overflowY);
    if (canScrollY && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

export class VerovioScorePreviewController implements ScorePreviewController {
  private readonly container: HTMLElement;
  private readonly adapter: VerovioScoreAdapter;
  private readonly playback: VerovioPlaybackPrototype;
  private activeCursor: HTMLElement | null = null;
  private activeSystem: Element | null = null;
  private activeEventIndex: number | null = null;
  private activeCursorMode: 'measure-start' | 'note' | null = null;
  private disposed = false;
  private readonly initialBpm: number | null;
  private readonly fitToContainerOptions: (pageWidth: number) => Record<string, unknown>;

  constructor(options: VerovioScorePreviewControllerOptions) {
    if (!options.container || !(options.container instanceof HTMLElement)) {
      throw new Error('Please pass a valid score preview container.');
    }
    this.container = options.container;
    this.adapter = options.adapter ?? new VerovioScoreAdapter(undefined, options.toolkitOptions);
    this.initialBpm = options.bpm && options.bpm > 0 ? options.bpm : null;
    this.fitToContainerOptions = options.fitToContainerOptions ?? ((pageWidth) => ({ pageWidth }));
    this.playback = new VerovioPlaybackPrototype(
      this.adapter,
      options.audioEngine ?? new SoundfontAudioEngine()
    );
  }

  async loadScore(xmlString: string) {
    this.assertActive();
    if (!xmlString.trim()) {
      throw new Error('No playable score (MusicXML is empty)');
    }
    await this.playback.loadScore(xmlString);
    if (this.initialBpm) {
      this.playback.setTempo(this.initialBpm);
    }
    this.renderPages(this.adapter.renderAllPages());
  }

  async fitToContainer() {
    this.assertActive();
    const width = this.container.clientWidth;
    if (width <= 0) {
      return;
    }
    const snapshot = this.playback.getPlaybackSnapshot();
    const pageWidth = Math.max(900, Math.round(width * 2.25));
    this.renderPages(this.adapter.relayout(this.fitToContainerOptions(pageWidth)));
    if (
      snapshot.totalSteps > 0
      && snapshot.state !== 'IDLE'
      && (snapshot.state !== 'STOPPED' || snapshot.currentTime > 0 || snapshot.currentStep > 0)
    ) {
      this.applyCursor(this.playback.getCursorSnapshotForStep(snapshot.currentStep));
    }
  }

  play() {
    return this.playback.play();
  }

  pause() {
    return this.playback.pause();
  }

  stop() {
    return this.playback.stop();
  }

  playFromStep(step: number) {
    return this.playback.playFromStep(step);
  }

  seek(time: number) {
    return this.playback.seek(time);
  }

  setTempo(bpm: number) {
    this.playback.setTempo(bpm);
  }

  getPlaybackSnapshot(): ScorePlaybackSnapshot {
    return this.playback.getPlaybackSnapshot();
  }

  onPlaybackIteration(listener: (notes: unknown[]) => void) {
    this.playback.onPlaybackIteration(listener);
  }

  onPlaybackStateChange(listener: (state: ScorePlaybackState) => void) {
    this.playback.onPlaybackStateChange(listener);
  }

  resetCursor(options?: CursorSyncOptions) {
    this.clearCursor();
    const firstVisibleEvent = this.findFirstVisibleEventElement();
    if (firstVisibleEvent) {
      this.applyCursorToElement(firstVisibleEvent, {
        ...options,
        eventIndex: -1,
        mode: 'note',
      });
      return;
    }

    this.applyCursor(this.playback.getCursorSnapshotForStep(0), options);
  }

  hideCursor() {
    this.clearCursor();
  }

  syncCursorToStep(step: number, options?: CursorSyncOptions) {
    this.applyCursor(this.playback.getCursorSnapshotForStep(step), options);
  }

  syncCursorDuringPlayback(step: number, options?: CursorSyncOptions) {
    this.applyCursor(this.playback.getCursorSnapshotForStep(step), {
      ...options,
      keepCurrentBeforeFirstEvent: true,
    });
  }

  ensureCursorVisible(options: CursorVisibilityOptions = {}) {
    const target = this.activeSystem ?? this.activeCursor;
    if (!target) {
      return;
    }

    const targetRect = target.getBoundingClientRect();

    if (options.scrollTarget === 'window') {
      const safeTop = Math.min(180, Math.max(96, window.innerHeight * 0.2));
      const safeBottom = window.innerHeight - Math.min(220, Math.max(140, window.innerHeight * 0.24));
      if (!options.force && targetRect.top >= safeTop && targetRect.bottom <= safeBottom) {
        return;
      }

      window.scrollTo({
        top: Math.max(0, window.scrollY + targetRect.top - safeTop),
        behavior: 'smooth',
      });
      return;
    }

    const scrollContainer = findScrollableAncestor(this.container);
    if (!scrollContainer) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const margin = Math.min(120, Math.max(32, scrollContainer.clientHeight * 0.18));
    if (
      !options.force
      && targetRect.top >= containerRect.top + margin
      && targetRect.bottom <= containerRect.bottom - margin
    ) {
      return;
    }

    const targetCenter = targetRect.top + targetRect.height / 2;
    const containerCenter = containerRect.top + containerRect.height / 2;
    scrollContainer.scrollTo({
      top: scrollContainer.scrollTop + targetCenter - containerCenter,
      behavior: 'smooth',
    });
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearCursor();
    this.container.replaceChildren();
    void this.playback.dispose();
  }

  private renderPages(pages: ReturnType<VerovioScoreAdapter['renderAllPages']>) {
    const fragment = document.createDocumentFragment();
    for (const page of pages) {
      const pageElement = document.createElement('div');
      pageElement.dataset.scorePage = String(page.pageNumber);
      pageElement.className = 'verovio-preview-page';
      pageElement.innerHTML = page.svg;
      fragment.append(pageElement);
    }
    this.container.replaceChildren(fragment);
    this.activeCursor = null;
    this.activeSystem = null;
    this.activeEventIndex = null;
    this.activeCursorMode = null;
  }

  private applyCursor(
    snapshot: VerovioPlaybackCursorSnapshot,
    options?: CursorPlacementOptions
  ) {
    const playbackSnapshot = this.playback.getPlaybackSnapshot();
    const isBeforeFirstEvent = snapshot.eventIndex === 0
      && snapshot.time > 0
      && playbackSnapshot.currentTime < snapshot.time;
    if (options?.keepCurrentBeforeFirstEvent && isBeforeFirstEvent && this.activeCursor && this.container.contains(this.activeCursor)) {
      return;
    }
    const shouldAlignBeforeFirstEvent = options?.alignBeforeFirstEventToMeasureStart !== false;
    const cursorMode = (options?.alignToMeasureStart || (shouldAlignBeforeFirstEvent && isBeforeFirstEvent)) && snapshot.time > 0
      ? 'measure-start'
      : 'note';
    if (
      cursorMode === this.activeCursorMode &&
      snapshot.eventIndex === this.activeEventIndex &&
      this.activeCursor?.isConnected
    ) {
      return;
    }
    const noteElement = snapshot.noteIds
      .map((noteId) => this.findElement(noteId))
      .find((element): element is HTMLElement => element !== null);
    if (!noteElement) {
      this.clearCursor();
      return;
    }

    this.applyCursorToElement(noteElement, {
      eventIndex: snapshot.eventIndex,
      mode: cursorMode,
    });
    if (options?.scrollIntoView) {
      this.ensureCursorVisible(options);
    }
  }

  private applyCursorToElement(
    element: HTMLElement,
    options: {
      eventIndex: number | null;
      mode: 'measure-start' | 'note';
    }
  ) {
    const page = element.closest<HTMLElement>('[data-score-page]');
    const system = element.closest('.system') ?? element.closest('svg');
    if (!page || !system) {
      this.clearCursor();
      return;
    }

    const pageRect = page.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const systemRect = system.getBoundingClientRect();
    const targetLeft = options.mode === 'measure-start'
      ? this.getInitialMeasureLeft(pageRect, element, system)
      : elementRect.left - pageRect.left + elementRect.width / 2;
    const cursorWidth = Math.max(10, Math.min(20, elementRect.width + 4));
    const cursor = this.activeCursor ?? document.createElement('div');
    if (!this.activeCursor) {
      cursor.className = 'score-playback-cursor';
      cursor.setAttribute('aria-hidden', 'true');
    }
    if (cursor.parentElement !== page) {
      page.append(cursor);
    }
    cursor.style.left = `${Math.max(0, targetLeft)}px`;
    cursor.style.width = `${cursorWidth}px`;
    cursor.style.top = `${Math.max(0, systemRect.top - pageRect.top)}px`;
    cursor.style.height = `${Math.max(1, systemRect.height)}px`;

    this.activeCursor = cursor;
    this.activeSystem = system;
    this.activeEventIndex = options.eventIndex;
    this.activeCursorMode = options.mode;
  }

  private clearCursor() {
    this.activeCursor?.remove();
    this.activeCursor = null;
    this.activeSystem = null;
    this.activeEventIndex = null;
    this.activeCursorMode = null;
  }

  private getInitialMeasureLeft(pageRect: DOMRect, noteElement: HTMLElement, system: Element) {
    const measure = noteElement.closest('.measure');
    const notationScope = measure ?? system;
    const clef = notationScope.querySelector('.clef');
    const keySignature = notationScope.querySelector('.keySig');
    const meterSignature = notationScope.querySelector('.meterSig');
    const staffDef = meterSignature ?? keySignature ?? clef;
    if (staffDef) {
      return staffDef.getBoundingClientRect().right - pageRect.left + 8;
    }

    if (measure) {
      return measure.getBoundingClientRect().left - pageRect.left;
    }

    return system.getBoundingClientRect().left - pageRect.left;
  }

  private findFirstVisibleEventElement() {
    return this.container.querySelector<HTMLElement>([
      '[data-score-page="1"] [data-class="rest"]',
      '[data-score-page="1"] .rest',
      '[data-score-page="1"] [data-class="mRest"]',
      '[data-score-page="1"] .mRest',
      '[data-score-page="1"] [data-class="note"]',
      '[data-score-page="1"] .note',
      '[data-score-page] [data-class="rest"]',
      '[data-score-page] .rest',
      '[data-score-page] [data-class="mRest"]',
      '[data-score-page] .mRest',
      '[data-score-page] [data-class="note"]',
      '[data-score-page] .note',
    ].join(', '));
  }

  private findElement(noteId: string) {
    if (!noteId) {
      return null;
    }
    return (
      this.container.querySelector<HTMLElement>(`[data-id="${noteId}"]`) ??
      this.container.querySelector<HTMLElement>(`#${escapeCssId(noteId)}`)
    );
  }

  private assertActive() {
    if (this.disposed) {
      throw new Error('Verovio score preview has been disposed.');
    }
  }
}
