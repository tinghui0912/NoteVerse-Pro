import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => resolve(process.cwd(), path);
const readSource = (path: string) => readFileSync(projectPath(path), 'utf8');

describe('route shell groups', () => {
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
    expect(existsSync(projectPath('src/components/layout/pill-nav.tsx'))).toBe(false);
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
    expect(invitePage).not.toContain('ScoreShell');
  });
});
