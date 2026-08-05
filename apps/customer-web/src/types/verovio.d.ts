declare module 'verovio/wasm' {
  export default function createVerovioModule(): Promise<unknown>;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    setOptions(options: Record<string, unknown>): boolean;
    loadData(data: string): boolean;
    renderToSVG(pageNo?: number, xmlDeclaration?: boolean): string;
    renderToMIDI(): string;
    renderToTimemap(options?: Record<string, unknown>): Array<Record<string, unknown>>;
    getPageCount(): number;
    getPageWithElement(xmlId: string): number;
    redoLayout(options?: Record<string, unknown>): void;
  }
}
