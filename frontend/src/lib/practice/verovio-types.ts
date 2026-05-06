export type VerovioToolkitLike = {
  setOptions(options: Record<string, unknown>): boolean;
  loadData(data: string): boolean;
  renderToSVG(pageNo?: number, xmlDeclaration?: boolean): string;
  renderToMIDI(): string;
  renderToTimemap(options?: Record<string, unknown>): Array<Record<string, unknown>>;
  getPageCount(): number;
  getPageWithElement(xmlId: string): number;
  redoLayout(options?: Record<string, unknown>): void;
};

export type VerovioRenderedPage = {
  pageNumber: number;
  svg: string;
};
