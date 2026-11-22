import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => resolve(process.cwd(), path);
const readSource = (path: string) => readFileSync(projectPath(path), 'utf8');

describe('score collaboration invite architecture', () => {
  it('keeps invite as a dedicated access-entry route with explicit proxy matching', () => {
    const proxy = readSource('src/proxy.ts');

    expect(existsSync(projectPath('src/app/[locale]/(invite)/invite/[token]/page.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/app/[locale]/(public)/invite'))).toBe(false);
    expect(proxy).toContain("'/invite/:path*'");
    expect(proxy).toContain("'/zh/invite/:path*'");
    expect(proxy).toContain("'/en/invite/:path*'");
    expect(proxy).not.toContain("'/invite'");
  });

  it('uses invite/member APIs for collaboration for authenticated collaboration', () => {
    const panel = readSource('src/features/scores/collaboration/owner-panel.tsx');
    const api = readSource('src/features/scores/collaboration/api.ts');
    const scorePage = readSource('src/features/scores/score-detail-page.tsx');

    expect(panel).toContain('useScoreInvites');
    expect(panel).toContain('useScoreMembers');
    expect(panel).toContain('useCreateScoreInvite');
    expect(panel).toContain('useUpdateScoreMember');

    expect(api).toContain('scoreInvitesList');
    expect(api).toContain('scoreMembersList');
    expect(api).toContain('scoreInviteInspect');
    expect(api).toContain('customerTransport.public');

    expect(scorePage).toContain('score.capabilities.can_manage_members');
    expect(scorePage).toContain('ScoreCollaborationPanel');
  });

  it('keeps preview and invite semantics separate', () => {
    const previewPanel = readSource('src/features/scores/guest-preview/owner-panel.tsx');
    const collaborationPanel = readSource(
      'src/features/scores/collaboration/owner-panel.tsx'
    );
    const invitePage = readSource('src/features/scores/collaboration/invite-page.tsx');

    expect(previewPanel).not.toContain('MembershipRole');
    expect(previewPanel).not.toContain('EDITOR');
    expect(previewPanel).not.toContain('VIEWER');
    expect(collaborationPanel).toContain('MembershipRole');
    expect(collaborationPanel).toContain('selectableMembershipRoles');
    expect(collaborationPanel).toContain('membershipRoleTranslationKey');
    expect(invitePage).toContain("searchParams.get('accept') === '1'");
    expect(invitePage).toContain('acceptInvite.mutate');
    expect(invitePage).toContain('router.push(scoreLocation(scoreId))');
  });

  it('preserves invite returnUrl through login and registration', () => {
    const loginPage = readSource('src/app/[locale]/(auth)/auth/login/page.tsx');
    const registerPage = readSource('src/app/[locale]/(auth)/auth/register/page.tsx');

    expect(loginPage).toContain("withReturnUrl('/auth/register', returnUrl)");
    expect(loginPage).toContain('router.push(getSafeReturnUrl(returnUrl))');
    expect(registerPage).toContain("withReturnUrl('/auth/login', returnUrl)");
  });


});
