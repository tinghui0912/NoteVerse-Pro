import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => resolve(process.cwd(), path);
const readSource = (path: string) => readFileSync(projectPath(path), 'utf8');

describe('score workspace routes', () => {
  it('keeps score as the product route family', () => {
    expect(existsSync(projectPath('src/app/[locale]/score/[id]/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/score/[id]/review/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/score/[id]/edit/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/score/[id]/practice/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/score/[id]/practice/performance/page.tsx'))).toBe(true);

    expect(existsSync(projectPath('src/app/[locale]/results'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/review'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/editor'))).toBe(false);
    expect(existsSync(projectPath('src/app/[locale]/practice'))).toBe(false);
  });

  it('protects score as one route family instead of standalone editor and practice pages', () => {
    const proxy = readSource('src/proxy.ts');

    expect(proxy).toContain("'/score'");
    expect(proxy).toContain("'/share'");
    expect(proxy).not.toContain("'/results'");
    expect(proxy).not.toContain("'/review'");
    expect(proxy).not.toContain("'/editor'");
    expect(proxy).not.toContain("'/practice'");
  });

  it('routes score detail actions into score workspaces', () => {
    const actions = readSource('src/components/score-detail/score-actions.tsx');
    const review = readSource('src/app/[locale]/score/[id]/review/page.tsx');
    const upload = readSource('src/components/upload/upload-types.ts');

    expect(actions).toContain('/score/${scoreId}/edit');
    expect(actions).toContain('/score/${scoreId}/practice');
    expect(review).toContain('/score/${scoreId}/edit?returnUrl=');
    expect(review).toContain('/score/${scoreId}/review');
    expect(review).toContain('<ScoreShell');
    expect(review).toContain('can_approve');
    expect(upload).toContain('/score/${scoreId}/review');
    expect(actions).not.toContain('/editor/${scoreId}');
    expect(actions).not.toContain('/practice/${scoreId}');
  });

  it('keeps share and public routes as score access entries', () => {
    const sharePage = readSource('src/app/[locale]/share/[shareId]/page.tsx');
    const shareSidebar = readSource('src/components/share/share-info-sidebar.tsx');
    const publicPage = readSource('src/components/public/public-score-page.tsx');

    expect(sharePage).toContain('<ScoreShell');
    expect(shareSidebar).toContain('/score/${props.scoreId}/practice?shareToken=${props.shareId}');
    expect(publicPage).toContain('<ScoreShell');
    expect(publicPage).toContain('/score/${scoreId}/practice?publicSlug=${slug}');
  });
});
