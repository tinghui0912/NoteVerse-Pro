export type VerovioToolkitLike = {
  setOptions(options: Record<string, unknown>): boolean;
  loadData(data: string): boolean;
  renderToSVG(pageNo?: number, xmlDeclaration?: boolean): string;
  renderToMIDI(): string;
  renderToTimemap(options?: Record<string, unknown>): Array<Record<string, unknown>>;
  getPageCount(): number;
  getPageWithElement(xmlId: string): number;
  getElementsAtTime?(milliseconds: number): Record<string, unknown>;
  redoLayout(options?: Record<string, unknown>): void;
};

export type VerovioRenderedPage = {
  pageNumber: number;
  svg: string;
};

export type VerovioToolkitFactory = () => Promise<VerovioToolkitLike>;

export type VerovioLoadOptions = {
  renderMidi?: boolean;
  prepareGenericRenderIds?: boolean;
  toolkitOptions?: Record<string, unknown>;
};
