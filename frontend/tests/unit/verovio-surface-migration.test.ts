import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('Verovio listen surfaces', () => {
  it.each([
    'src/components/share/share-actions.tsx',
    'src/components/editor/editor-page-modals.tsx',
  ])('%s uses the renderer-agnostic ListenModal API', (path) => {
    const source = readSource(path);
    expect(source).toContain('<ListenModal');
    expect(source).not.toContain('backend=');
  });

  it('renders results with a shared viewport and persistent playback dock', () => {
    const page = readSource('src/app/[locale]/results/[id]/page.tsx');
    const actions = readSource('src/components/results/results-actions.tsx');
    const player = readSource('src/components/results/results-score-player.tsx');
    expect(page).toContain('<ResultsScorePlayer');
    expect(page).toContain('<ResultsBreadcrumbs');
    expect(page).not.toContain('<ResultsScorePreview');
    expect(actions).not.toContain('<ListenModal');
    expect(player).toContain('<ScorePreviewViewport');
    expect(player).toContain('<ResultsPlaybackDock');
    expect(player).toContain("followViewport: 'window'");
    expect(player).not.toContain('<ScorePreviewPanel');
    expect(player).not.toContain('<CardTitle');
  });

  it('dynamically loads only the Verovio preview controller', () => {
    const source = readSource('src/hooks/score/use-score-preview-playback.ts');
    expect(source).toContain("'@/lib/score/verovio-score-preview-controller'");
  });
});
