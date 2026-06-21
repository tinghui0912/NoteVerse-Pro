import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Verovio listen surfaces', () => {
  it.each([
    'src/components/results/results-actions.tsx',
    'src/components/share/share-actions.tsx',
    'src/components/editor/editor-page-modals.tsx',
  ])('%s uses the renderer-agnostic ListenModal API', (path) => {
    const source = readSource(path);
    expect(source).toContain('<ListenModal');
    expect(source).not.toContain('backend=');
  });

  it('dynamically loads only the Verovio preview controller', () => {
    const source = readSource('src/components/score/listen-modal.tsx');
    expect(source).toContain("import('@/lib/score/verovio-score-preview-controller')");
  });
});
