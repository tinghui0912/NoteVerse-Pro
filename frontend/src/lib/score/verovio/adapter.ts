import { sanitizeMusicXmlForVerovio } from './sanitize';
import { createVerovioToolkit } from './toolkit';
import type {
  VerovioLoadOptions,
  VerovioRenderedPage,
  VerovioToolkitFactory,
  VerovioToolkitLike,
} from './types';

const DEFAULT_TOOLKIT_OPTIONS: Record<string, unknown> = {
  inputFrom: 'xml',
  pageHeight: 2600,
  pageWidth: 1800,
  scale: 42,
  header: 'auto',
  footer: 'auto',
  adjustPageHeight: true,
  svgHtml5: true,
  breaks: 'auto',
};

export class VerovioScoreAdapter {
  private toolkit: VerovioToolkitLike | null = null;

  constructor(private readonly toolkitFactory: VerovioToolkitFactory = createVerovioToolkit) {}

  async loadMusicXml(xml: string, options: VerovioLoadOptions = {}) {
    const toolkit = await this.toolkitFactory();
    toolkit.setOptions({
      ...DEFAULT_TOOLKIT_OPTIONS,
      ...options.toolkitOptions,
    });

    if (!toolkit.loadData(sanitizeMusicXmlForVerovio(xml))) {
      throw new Error('Verovio failed to load the score.');
    }

    if (options.renderMidi) {
      toolkit.renderToMIDI();
    }
    this.toolkit = toolkit;
  }

  protected ensureReady() {
    if (!this.toolkit) {
      throw new Error('Verovio toolkit is not ready.');
    }
    return this.toolkit;
  }

  renderAllPages(): VerovioRenderedPage[] {
    const toolkit = this.ensureReady();
    return Array.from({ length: toolkit.getPageCount() }, (_, index) => ({
      pageNumber: index + 1,
      svg: toolkit.renderToSVG(index + 1, false),
    }));
  }

  getPageCount() {
    return this.ensureReady().getPageCount();
  }

  getPageWithElement(xmlId: string) {
    return this.ensureReady().getPageWithElement(xmlId);
  }

  getElementsAtTime(milliseconds: number) {
    return this.ensureReady().getElementsAtTime?.(milliseconds) ?? null;
  }

  renderTimemap(options: Record<string, unknown> = {}) {
    return this.ensureReady().renderToTimemap(options);
  }

  renderMidi() {
    return this.ensureReady().renderToMIDI();
  }

  relayout(options: Record<string, unknown> = {}) {
    this.ensureReady().redoLayout(options);
    return this.renderAllPages();
  }

  dispose() {
    this.toolkit = null;
  }
}
