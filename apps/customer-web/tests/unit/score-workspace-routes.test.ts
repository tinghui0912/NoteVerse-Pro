import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => resolve(process.cwd(), path);
const readSource = (path: string) => readFileSync(projectPath(path), 'utf8');

describe('score workspace routes', () => {
  it('keeps score as the product route family', () => {
    expect(existsSync(projectPath('src/app/[locale]/(app)/score/[id]/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(workspace)/score/[id]/edit/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(workspace)/score/[id]/practice/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(workspace)/score/[id]/practice/review/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(workspace)/score/[id]/practice/summary/page.tsx'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/(app)/review/[jobId]/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(workspace)/review/[jobId]/edit/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(guest-preview)/preview/[token]/page.tsx'))).toBe(true);

    expect(existsSync(projectPath('src/app/[locale]/results'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/editor'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/practice'))).toBe(false);
  });

  it('protects score as one route family instead of standalone editor and practice pages', () => {
    const proxy = readSource('src/proxy.ts');

    expect(proxy).toContain("'/score'");
    expect(proxy).toContain("'/review'");
    expect(proxy).not.toContain("'/preview'");
    expect(proxy).not.toContain("'/results'");
    expect(proxy).not.toContain("'/editor'");
    expect(proxy).not.toContain("'/practice'");
  });

  it('routes score detail actions into score workspaces', () => {
    const actions = readSource('src/components/score-detail/score-hero-actions.tsx');
    const upload = readSource('src/lib/upload/upload-workflow.ts');
    const reviewPage = readSource('src/app/[locale]/(app)/review/[jobId]/page.tsx');
    const scoreEditor = readSource('src/app/[locale]/(workspace)/score/[id]/edit/page.tsx');
    const reviewEditor = readSource('src/app/[locale]/(workspace)/review/[jobId]/edit/page.tsx');

    expect(actions).toContain('/score/${scoreId}/edit');
    expect(actions).toContain("practiceLocation(scoreId, 'setup', revisionId)");
    expect(upload).toContain('/review/${jobId}');
    expect(reviewPage).toContain('/review/${jobId}/edit');
    expect(scoreEditor).toContain('<EditorWorkspacePage');
    expect(reviewEditor).toContain('<EditorWorkspacePage');
    expect(actions).not.toContain('/editor/${scoreId}');
    expect(actions).not.toContain('/practice/${scoreId}');
  });

  it('places preview presentation in its dedicated route and shell', () => {
    const page = readSource('src/app/[locale]/(guest-preview)/preview/[token]/page.tsx');
    const layout = readSource('src/app/[locale]/(guest-preview)/layout.tsx');
    expect(page).toContain('<GuestPreviewPage token={token}');
    expect(page).toContain('noarchive: true');
    expect(layout).toContain('<LanguageSwitcher');
  });

  it('centralizes view/share capabilities without a score shell wrapper', () => {
    const surface = readSource('src/components/score/score-surface.tsx');
    const capabilityContext = readSource('src/components/score/score-capability-context.tsx');
    const actions = readSource('src/components/score-detail/score-hero-actions.tsx');
    const metadata = readSource('src/components/score-detail/score-info-panel.tsx');

    expect(existsSync(projectPath('src/components/score-shell'))).toBe(false);
    expect(surface).toContain('ScoreSurface');
    expect(capabilityContext).toContain('ScoreCapabilityContext.Provider');
    expect(capabilityContext).toContain('resolveScoreCapabilities');
    expect(capabilityContext).toContain('useScoreCapabilities');
    expect(actions).toContain('useScoreCapabilities');
    expect(metadata).toContain('useScoreCapabilities');
    expect(actions).not.toContain('capabilities?:');
  });
});
