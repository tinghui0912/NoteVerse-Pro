import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => resolve(process.cwd(), path);
const readSource = (path: string) => readFileSync(projectPath(path), 'utf8');

describe('score collaboration invite architecture', () => {
  it('keeps invite as a public access-entry route with explicit proxy matching', () => {
    const proxy = readSource('src/proxy.ts');

    expect(existsSync(projectPath('src/app/[locale]/invite/[token]/page.tsx'))).toBe(true);
    expect(proxy).toContain("'/invite/:path*'");
    expect(proxy).toContain("'/zh/invite/:path*'");
    expect(proxy).toContain("'/en/invite/:path*'");
    expect(proxy).not.toContain("'/invite'");
  });

  it('uses invite/member APIs for collaboration instead of share grant APIs', () => {
    const dialog = readSource('src/components/score-detail/score-collaboration-dialog.tsx');
    const api = readSource('src/lib/api/score-invites.ts');
    const actions = readSource('src/components/score-detail/score-actions.tsx');

    expect(dialog).toContain('useScoreInvites');
    expect(dialog).toContain('useScoreMembers');
    expect(dialog).toContain('useCreateScoreInvite');
    expect(dialog).toContain('useUpdateScoreMember');
    expect(dialog).not.toContain('useScoreGrants');
    expect(dialog).not.toContain('scoreSharingApi');

    expect(api).toContain('/scores/${scoreId}/invites');
    expect(api).toContain('/scores/${scoreId}/members');
    expect(api).toContain('/invites/${token}');
    expect(api).toContain('suppressAuthRedirect: true');

    expect(actions).toContain('capabilities.can_manage_members');
    expect(actions).toContain('ScoreCollaborationDialog');
  });

  it('keeps share and invite semantics separate', () => {
    const shareDialog = readSource('src/components/score-detail/score-share-dialog.tsx');
    const collaborationDialog = readSource('src/components/score-detail/score-collaboration-dialog.tsx');
    const invitePage = readSource('src/app/[locale]/invite/[token]/page.tsx');

    expect(shareDialog).not.toContain('MembershipRole');
    expect(shareDialog).not.toContain('EDITOR');
    expect(shareDialog).not.toContain('VIEWER');
    expect(collaborationDialog).toContain('MembershipRole');
    expect(collaborationDialog).toContain('EDITOR');
    expect(collaborationDialog).toContain('VIEWER');
    expect(invitePage).toContain("searchParams.get('accept') === '1'");
    expect(invitePage).toContain('acceptInvite.mutate');
    expect(invitePage).toContain("router.push(`/score/${scoreId}`)");
  });

  it('preserves invite returnUrl through login and registration', () => {
    const loginPage = readSource('src/app/[locale]/login/page.tsx');
    const registerPage = readSource('src/app/[locale]/register/page.tsx');

    expect(loginPage).toContain("withReturnUrl('/register', returnUrl)");
    expect(loginPage).toContain('router.push(getSafeReturnUrl(returnUrl))');
    expect(registerPage).toContain("withReturnUrl('/login', returnUrl)");
    expect(registerPage).toContain('router.push(getSafeReturnUrl(returnUrl))');
  });

  it('keeps notification center as a projection over pending invites and notification events', () => {
    const nav = readSource('src/components/layout/pill-nav.tsx');
    const center = readSource('src/components/notifications/notification-center-dialog.tsx');
    const notificationsApi = readSource('src/lib/api/notifications.ts');
    const notificationHooks = readSource('src/hooks/queries/use-notification-queries.ts');

    expect(nav).toContain('NotificationCenterDialog');
    expect(nav).toContain('useMyPendingScoreInvites');
    expect(nav).toContain('useNotificationUnreadCount');
    expect(nav).toContain('badgeCount = pendingInviteCount + unreadNotificationCount');

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
