import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => resolve(process.cwd(), path);
const readSource = (path: string) => readFileSync(projectPath(path), 'utf8');

describe('route shell groups', () => {
  it('keeps shared chrome primitives in semantic component directories', () => {
    expect(existsSync(projectPath('src/components/layout'))).toBe(false);
    expect(existsSync(projectPath('src/components/providers/client-providers.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/navigation/nav-actions.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/page/page-header.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/home'))).toBe(false);
    expect(existsSync(projectPath('src/components/marketing/animated-section.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/marketing/marketing-footer.tsx'))).toBe(true);
  });

  it('keeps route shells in the shared shell directory', () => {
    for (const shellName of [
      'app-shell',
      'auth-shell',
      'external-viewer-shell',
      'invite-shell',
      'public-shell',
      'workspace-shell',
    ]) {
      expect(existsSync(projectPath(`src/components/shell/${shellName}.tsx`))).toBe(true);
    }

    expect(existsSync(projectPath('src/components/app-shell'))).toBe(false);
    expect(existsSync(projectPath('src/components/external-viewer'))).toBe(false);
    expect(existsSync(projectPath('src/components/workspace-shell'))).toBe(false);
    expect(existsSync(projectPath('src/components/auth/auth-shell.tsx'))).toBe(false);
  });

  it('keeps auth flows in a dedicated AuthShell route group', () => {
    expect(existsSync(projectPath('src/app/[locale]/(auth)/layout.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(auth)/auth/login/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(auth)/auth/register/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(auth)/auth/forgot-password/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(auth)/auth/reset-password/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(public)/auth'))).toBe(false);

    const authLayout = readSource('src/app/[locale]/(auth)/layout.tsx');
    const publicLayout = readSource('src/app/[locale]/(public)/layout.tsx');

    expect(authLayout).toContain('<AuthShell>');
    expect(publicLayout).toContain('<PublicShell>');
    expect(publicLayout).not.toContain('AuthShell');
  });

  it('keeps public and invite routes in purpose-built shells', () => {
    expect(existsSync(projectPath('src/components/navigation/public-nav.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/shell/public-shell.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/shell/invite-shell.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(invite)/layout.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(invite)/invite/[token]/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(public)/invite'))).toBe(false);

    const publicShell = readSource('src/components/shell/public-shell.tsx');
    const inviteLayout = readSource('src/app/[locale]/(invite)/layout.tsx');
    const invitePage = readSource('src/app/[locale]/(invite)/invite/[token]/page.tsx');

    expect(publicShell).toContain('<PublicNav');
    expect(inviteLayout).toContain('<InviteShell>');
    expect(invitePage).not.toContain('ScoreSurface');

    for (const publicPage of [
      'src/app/[locale]/(public)/page.tsx',
      'src/app/[locale]/(public)/subscriptions/page.tsx',
      'src/app/[locale]/(public)/help/page.tsx',
    ]) {
      const source = readSource(publicPage);

      expect(source).toContain('MarketingFooter');
      expect(source).not.toContain("components/layout/footer");
      expect(source).not.toContain("components/home");
    }
  });

  it('keeps external viewer components in the external component directory', () => {
    expect(existsSync(projectPath('src/components/external/public-score-page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/external/share-info-sidebar.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/external/share-score-player.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/public'))).toBe(false);
    expect(existsSync(projectPath('src/components/share'))).toBe(false);

    const publicEntry = readSource('src/app/[locale]/(external)/public/[slug]/page.tsx');
    const shareEntry = readSource('src/app/[locale]/(external)/share/[shareId]/page.tsx');

    expect(publicEntry).toContain('@/components/external/public-score-page');
    expect(shareEntry).toContain('@/components/external/share-info-sidebar');
    expect(shareEntry).toContain('@/components/external/share-score-player');
  });

  it('keeps upload workflow primitives out of component modules', () => {
    expect(existsSync(projectPath('src/lib/upload/upload-workflow.ts'))).toBe(true);
    expect(existsSync(projectPath('src/components/upload/upload-types.ts'))).toBe(false);

    const uploadForm = readSource('src/components/upload/upload-form.tsx');
    const uploadPreview = readSource('src/components/upload/upload-preview-dialog.tsx');
    const uploadHook = readSource('src/hooks/upload/use-upload-workflow.ts');

    expect(uploadForm).toContain('@/lib/upload/upload-workflow');
    expect(uploadPreview).toContain('@/lib/upload/upload-workflow');
    expect(uploadHook).toContain('@/lib/upload/upload-workflow');
    expect(uploadHook).not.toContain('@/components/upload');
  });
});
