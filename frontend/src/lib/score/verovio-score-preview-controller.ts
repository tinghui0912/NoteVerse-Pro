'use client';

import type {
  CursorSyncOptions,
  ScorePlaybackSnapshot,
  ScorePlaybackState,
  ScorePreviewController,
} from './contracts';
import { VerovioScoreAdapter } from './verovio';
import {
  SoundfontAudioEngine,
  VerovioPlaybackPrototype,
  type VerovioAudioEngine,
  type VerovioPlaybackCursorSnapshot,
} from './verovio/playback';

type VerovioScorePreviewControllerOptions = {
  container: HTMLElement;
  bpm?: number;
  adapter?: VerovioScoreAdapter;
  audioEngine?: VerovioAudioEngine;
};

function escapeCssId(id: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

export class VerovioScorePreviewController implements ScorePreviewController {
  private readonly container: HTMLElement;
  private readonly adapter: VerovioScoreAdapter;
  private readonly playback: VerovioPlaybackPrototype;
  private activeNoteIds: string[] = [];
  private activePage: number | null = null;
  private disposed = false;
  private readonly initialBpm: number | null;

  constructor(options: VerovioScorePreviewControllerOptions) {
    if (!options.container || !(options.container instanceof HTMLElement)) {
      throw new Error('Please pass a valid score preview container.');
    }
    this.container = options.container;
    this.adapter = options.adapter ?? new VerovioScoreAdapter();
    this.initialBpm = options.bpm && options.bpm > 0 ? options.bpm : null;
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
    this.renderPages(
      this.adapter.relayout({ pageWidth: Math.max(900, Math.round(width * 2.25)) })
    );
    this.syncCursorToStep(snapshot.currentStep);
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
    this.applyCursor(this.playback.getCursorSnapshotForStep(0), options);
  }

  syncCursorToStep(step: number, options?: CursorSyncOptions) {
    this.applyCursor(this.playback.getCursorSnapshotForStep(step), options);
  }

  ensureCursorVisible() {
    const activeNode = this.activeNoteIds.length > 0
      ? this.findElement(this.activeNoteIds[0] ?? '')
      : null;
    activeNode?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
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
  }

  private applyCursor(snapshot: VerovioPlaybackCursorSnapshot, options?: CursorSyncOptions) {
    this.clearCursor();
    for (const noteId of snapshot.noteIds) {
      const element = this.findElement(noteId);
      element?.classList.add('score-playback-active');
      if (element) {
        this.activeNoteIds.push(noteId);
      }
    }
    this.activePage = snapshot.pageNumbers[0] ?? null;
    if (options?.scrollIntoView) {
      const page = this.activePage
        ? this.container.querySelector<HTMLElement>(`[data-score-page="${this.activePage}"]`)
        : null;
      const target = this.findElement(this.activeNoteIds[0] ?? '') ?? page;
      target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    }
  }

  private clearCursor() {
    for (const noteId of this.activeNoteIds) {
      this.findElement(noteId)?.classList.remove('score-playback-active');
    }
    this.activeNoteIds = [];
    this.activePage = null;
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
