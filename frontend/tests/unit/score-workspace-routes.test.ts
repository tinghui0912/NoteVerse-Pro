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
    expect(existsSync(projectPath('src/app/[locale]/(workspace)/score/[id]/practice/performance/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(app)/review/[jobId]/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(workspace)/review/[jobId]/edit/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(external)/share/[shareId]/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(external)/public/[slug]/page.tsx'))).toBe(true);

    expect(existsSync(projectPath('src/app/[locale]/results'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/editor'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/practice'))).toBe(false);
  });

  it('protects score as one route family instead of standalone editor and practice pages', () => {
    const proxy = readSource('src/proxy.ts');

    expect(proxy).toContain("'/score'");
    expect(proxy).toContain("'/review'");
    expect(proxy).not.toContain("'/share'");
    expect(proxy).not.toContain("'/public'");
    expect(proxy).not.toContain("'/results'");
    expect(proxy).not.toContain("'/editor'");
    expect(proxy).not.toContain("'/practice'");
  });

  it('routes score detail actions into score workspaces', () => {
    const actions = readSource('src/components/score-detail/score-actions.tsx');
    const upload = readSource('src/lib/upload/upload-workflow.ts');
    const reviewPage = readSource('src/app/[locale]/(app)/review/[jobId]/page.tsx');
    const scoreEditor = readSource('src/app/[locale]/(workspace)/score/[id]/edit/page.tsx');
    const reviewEditor = readSource('src/app/[locale]/(workspace)/review/[jobId]/edit/page.tsx');

    expect(actions).toContain('/score/${scoreId}/edit');
    expect(actions).toContain('/score/${scoreId}/practice');
    expect(upload).toContain('/review/${jobId}');
    expect(reviewPage).toContain('/review/${jobId}/edit');
    expect(scoreEditor).toContain('<EditorWorkspacePage');
    expect(reviewEditor).toContain('<EditorWorkspacePage');
    expect(actions).not.toContain('/editor/${scoreId}');
    expect(actions).not.toContain('/practice/${scoreId}');
  });

  it('keeps share and public routes as score access entries', () => {
    const sharePage = readSource('src/app/[locale]/(external)/share/[shareId]/page.tsx');
    const shareSidebar = readSource('src/components/external/share-info-sidebar.tsx');
    const publicPage = readSource('src/components/external/public-score-page.tsx');

    expect(sharePage).toContain('<ScoreSurface');
    expect(sharePage).toContain('<ScoreCapabilityProvider');
    expect(sharePage).toContain('capabilities={data.capabilities}');
    expect(shareSidebar).toContain('/score/${props.scoreId}/practice?shareToken=${props.shareId}');
    expect(publicPage).toContain('<ScoreSurface');
    expect(publicPage).toContain('<ScoreCapabilityProvider');
    expect(publicPage).toContain('capabilities={capabilities}');
    expect(publicPage).toContain('/score/${scoreId}/practice?publicSlug=${slug}');
  });

  it('centralizes view/share capabilities without a score shell wrapper', () => {
    const surface = readSource('src/components/score/score-surface.tsx');
    const capabilityContext = readSource('src/components/score/score-capability-context.tsx');
    const actions = readSource('src/components/score-detail/score-actions.tsx');
    const metadata = readSource('src/components/score-detail/score-metadata-editor.tsx');
    const styleTags = readSource('src/components/score-detail/score-style-tags-editor.tsx');
    const shareSidebar = readSource('src/components/external/share-info-sidebar.tsx');

    expect(existsSync(projectPath('src/components/score-shell'))).toBe(false);
    expect(surface).toContain('ScoreSurface');
    expect(capabilityContext).toContain('ScoreCapabilityContext.Provider');
    expect(capabilityContext).toContain('resolveScoreCapabilities');
    expect(capabilityContext).toContain('useScoreCapabilities');
    expect(actions).toContain('useScoreCapabilities');
    expect(metadata).toContain('useScoreCapabilities');
    expect(styleTags).toContain('useScoreCapabilities');
    expect(shareSidebar).toContain('useScoreCapabilities');
    expect(actions).not.toContain('capabilities?:');
    expect(shareSidebar).not.toContain('capabilities?:');
  });
});
