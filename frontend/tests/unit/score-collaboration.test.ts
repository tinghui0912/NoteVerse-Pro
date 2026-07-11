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

  it('uses invite/member APIs for collaboration instead of share grant APIs', () => {
    const panel = readSource('src/components/score-detail/score-collaboration-panel.tsx');
    const api = readSource('src/lib/api/score-invites.ts');
    const scorePage = readSource('src/app/[locale]/(app)/score/[id]/page.tsx');

    expect(panel).toContain('useScoreInvites');
    expect(panel).toContain('useScoreMembers');
    expect(panel).toContain('useCreateScoreInvite');
    expect(panel).toContain('useUpdateScoreMember');
    expect(panel).not.toContain('useScoreGrants');
    expect(panel).not.toContain('scoreSharingApi');

    expect(api).toContain('/scores/${scoreId}/invites');
    expect(api).toContain('/scores/${scoreId}/members');
    expect(api).toContain('/invites/${token}');
    expect(api).toContain('suppressAuthRedirect: true');

    expect(scorePage).toContain('score.capabilities.can_manage_members');
    expect(scorePage).toContain('ScoreCollaborationPanel');
  });

  it('keeps share and invite semantics separate', () => {
    const sharePanel = readSource('src/components/score-detail/score-share-panel.tsx');
    const collaborationPanel = readSource('src/components/score-detail/score-collaboration-panel.tsx');
    const invitePage = readSource('src/app/[locale]/(invite)/invite/[token]/page.tsx');

    expect(sharePanel).not.toContain('MembershipRole');
    expect(sharePanel).not.toContain('EDITOR');
    expect(sharePanel).not.toContain('VIEWER');
    expect(collaborationPanel).toContain('MembershipRole');
    expect(collaborationPanel).toContain('EDITOR');
    expect(collaborationPanel).toContain('VIEWER');
    expect(invitePage).toContain("searchParams.get('accept') === '1'");
    expect(invitePage).toContain('acceptInvite.mutate');
    expect(invitePage).toContain("router.push(`/score/${scoreId}`)");
  });

  it('preserves invite returnUrl through login and registration', () => {
    const loginPage = readSource('src/app/[locale]/(auth)/auth/login/page.tsx');
    const registerPage = readSource('src/app/[locale]/(auth)/auth/register/page.tsx');

    expect(loginPage).toContain("withReturnUrl('/auth/register', returnUrl)");
    expect(loginPage).toContain('router.push(getSafeReturnUrl(returnUrl))');
    expect(registerPage).toContain("withReturnUrl('/auth/login', returnUrl)");
  });

  it('keeps notification center as a projection over pending invites and notification events', () => {
    const navActions = readSource('src/components/navigation/nav-actions.tsx');
    const center = readSource('src/components/notifications/notification-center-dialog.tsx');
    const notificationsApi = readSource('src/lib/api/notifications.ts');
    const notificationHooks = readSource('src/hooks/queries/use-notification-queries.ts');

    expect(navActions).toContain('NotificationCenterDialog');
    expect(navActions).toContain('useMyPendingScoreInvites');
    expect(navActions).toContain('useNotificationUnreadCount');
    expect(navActions).toContain('badgeCount = pendingInviteCount + unreadNotificationCount');

    expect(center).toContain('useMyPendingScoreInvites');
    expect(center).toContain('useMyNotifications');
    expect(center).toContain('pendingInvitesQuery.isError');
    expect(center).toContain('notificationsQuery.isError');
    expect(center).toContain('pendingInvitesQuery.refetch()');
    expect(center).toContain('notificationsQuery.refetch()');
    expect(center).toContain("useState<'all' | 'unread'>('all')");
    expect(center).toContain("updateFilter === 'unread'");
    expect(center).toContain("notification.type === 'score_invite.accepted'");
    expect(center).toContain("notification.type === 'score_invite.declined'");
    expect(center).toContain("notification.type === 'score.version.created'");
    expect(center).toContain('notificationHref(notification)');
    expect(center).toContain('router.push(href)');

    expect(notificationsApi).toContain('/me/notifications');
    expect(notificationsApi).toContain('/me/notifications/unread-count');
    expect(notificationsApi).toContain('/me/notifications/${notificationId}/read');
    expect(notificationHooks).toContain('queryKeys.notifications.list()');
    expect(notificationHooks).toContain('queryKeys.notifications.unreadCount()');
  });
});
