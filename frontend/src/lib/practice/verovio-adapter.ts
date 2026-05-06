import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

import type { VerovioRenderedPage, VerovioToolkitLike } from './verovio-types';
import { parseXml, serializeXml } from '@/lib/musicxml-core';

let toolkitPromise: Promise<VerovioToolkitLike> | null = null;

async function getToolkit() {
  if (!toolkitPromise) {
    toolkitPromise = createVerovioModule().then((verovioModule) => {
      return new VerovioToolkit(verovioModule) as VerovioToolkitLike;
    });
  }
  return toolkitPromise;
}

function sanitizeMusicXmlForVerovio(xml: string) {
  const xmlDoc = parseXml(xml);
  const measures = Array.from(xmlDoc.querySelectorAll('measure'));

  for (const measure of measures) {
    const anchorByVoiceStaff = new Map<string, Element>();
    const children = Array.from(measure.children);

    for (const child of children) {
      if (child.tagName !== 'note') {
        continue;
      }

      const voice = child.querySelector('voice')?.textContent?.trim() || '1';
      const staff = child.querySelector('staff')?.textContent?.trim() || '1';
      const key = `${voice}:${staff}`;
      const hasChordTag = child.querySelector('chord') !== null;
      const hasPitch = child.querySelector('pitch') !== null;
      const hasRest = child.querySelector('rest') !== null;

      if (hasChordTag) {
        // Verovio is stricter than our editor output. Chord members should not carry
        // beam/rest/blank-like state, and a chord member without a valid anchor needs
        // to fall back to a standalone note so the score still renders.
        child.querySelectorAll('beam').forEach((beam) => beam.remove());

        const anchor = anchorByVoiceStaff.get(key);
        if (!anchor || hasRest || !hasPitch) {
          child.querySelector('chord')?.remove();
          anchorByVoiceStaff.set(key, child);
          continue;
        }

        continue;
      }

      anchorByVoiceStaff.set(key, child);
    }
  }

  return serializeXml(xmlDoc);
}

export class PracticeVerovioAdapter {
  private toolkit: VerovioToolkitLike | null = null;
  private noteTimeline: string[][] = [];

  async loadMusicXml(xml: string) {
    const toolkit = await getToolkit();
    const sanitizedXml = sanitizeMusicXmlForVerovio(xml);
    toolkit.setOptions({
      inputFrom: 'xml',
      pageHeight: 2600,
      pageWidth: 1800,
      scale: 42,
      header: 'none',
      footer: 'none',
      adjustPageHeight: true,
      svgHtml5: true,
      breaks: 'auto',
    });

    const loaded = toolkit.loadData(sanitizedXml);
    if (!loaded) {
      throw new Error('Verovio failed to load the practice score.');
    }

    toolkit.renderToMIDI();
    this.noteTimeline = toolkit
      .renderToTimemap({})
      .map((entry) => {
        return Array.isArray(entry.on)
          ? entry.on.filter((value): value is string => typeof value === 'string')
          : [];
      })
      .filter((noteIds) => noteIds.length > 0);
    this.toolkit = toolkit;
  }

  ensureReady() {
    if (!this.toolkit) {
      throw new Error('Verovio toolkit is not ready.');
    }
    return this.toolkit;
  }

  renderAllPages(): VerovioRenderedPage[] {
    const toolkit = this.ensureReady();
    const pageCount = toolkit.getPageCount();
    const pages: VerovioRenderedPage[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      pages.push({
        pageNumber,
        svg: toolkit.renderToSVG(pageNumber, false),
      });
    }

    return pages;
  }

  getPageCount() {
    return this.ensureReady().getPageCount();
  }

  getPageWithElement(xmlId: string) {
    return this.ensureReady().getPageWithElement(xmlId);
  }

  getNoteIdsForEventIndex(eventIndex: number): string[] {
    if (eventIndex < 0 || this.noteTimeline.length === 0) {
      return [];
    }

    const clampedIndex = Math.min(eventIndex, this.noteTimeline.length - 1);
    return this.noteTimeline[clampedIndex] ?? [];
  }
}
