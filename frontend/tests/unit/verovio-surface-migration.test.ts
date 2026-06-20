import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Verovio listen surface migration', () => {
  it.each([
    'src/components/results/results-actions.tsx',
    'src/components/share/share-actions.tsx',
    'src/components/editor/editor-page-modals.tsx',
  ])('%s selects the Verovio backend explicitly', (path) => {
    const source = readSource(path);
    expect(source).toContain('backend="verovio"');
    expect(source).not.toContain('OsmdScorePreviewController');
  });

  it('keeps renderer implementations behind dynamic modal boundaries', () => {
    const source = readSource('src/components/score/listen-modal.tsx');
    expect(source).toContain("import('@/lib/score/verovio-score-preview-controller')");
    expect(source).toContain("import('@/lib/score/osmd-score-preview-controller')");
    expect(source).not.toContain("from '@/lib/score/osmd-score-preview-controller'");
  });
});
