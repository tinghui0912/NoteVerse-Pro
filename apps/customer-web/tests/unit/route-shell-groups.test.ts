import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectPath = (path: string) => resolve(process.cwd(), path);
const readSource = (path: string) => readFileSync(projectPath(path), 'utf8');

describe('route shell groups', () => {
  it('keeps shared chrome primitives in semantic component directories', () => {
    expect(existsSync(projectPath('src/components/layout'))).toBe(false);
    expect(existsSync(projectPath('src/components/providers/client-providers.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/navigation/index.ts'))).toBe(true);
    expect(existsSync(projectPath('src/components/navigation/nav-actions.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/page/page-header.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/page/index.ts'))).toBe(true);
    expect(existsSync(projectPath('src/components/home'))).toBe(false);
    expect(existsSync(projectPath('src/components/marketing/animated-section.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/marketing/marketing-footer.tsx'))).toBe(true);

    const navigationIndex = readSource('src/components/navigation/index.ts');
    const pageIndex = readSource('src/components/page/index.ts');

    expect(navigationIndex).toContain("export { PublicNav }");
    expect(navigationIndex).toContain('AuthenticatedNavActions');
    expect(pageIndex).toContain("export { PageHeader }");
  });

  it('keeps route shells in the shared shell directory', () => {
    expect(existsSync(projectPath('src/components/shell/index.ts'))).toBe(true);

    for (const shellName of [
      'app-shell',
      'auth-shell',
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
    const publicNav = readSource('src/components/navigation/public-nav.tsx');
    const inviteLayout = readSource('src/app/[locale]/(invite)/layout.tsx');
    const invitePage = readSource('src/app/[locale]/(invite)/invite/[token]/page.tsx');

    expect(publicShell).toContain('<PublicNav');
    expect(publicNav).toContain("href: '/subscriptions'");
    expect(publicNav).toContain("href: '/help'");
    expect(publicNav).toContain('<AuthenticatedNavActions />');
    expect(publicNav).toContain('returnToApp');
    expect(publicNav).not.toContain('openApp');
    expect(publicNav).not.toContain("href: '/upload'");
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


  it('uses one authenticated nav action pattern across public, invite, and workspace shells', () => {
    const actions = readSource('src/components/navigation/nav-actions.tsx');
    const publicNav = readSource('src/components/navigation/public-nav.tsx');
    const inviteShell = readSource('src/components/shell/invite-shell.tsx');
    const workspaceShell = readSource('src/components/shell/workspace-shell.tsx');

    expect(actions).toContain('function ReturnToAppButton');
    expect(actions).toContain('LayoutDashboard');
    expect(actions).toContain("t('returnToApp')");
    expect(actions).toContain('function AuthenticatedNavActions');
    expect(actions).toContain('showNotifications');
    expect(actions).toContain('<ReturnToAppButton');
    expect(actions).toContain('<LanguageSwitcher');
    expect(actions).toContain('<UserMenu');

    expect(publicNav).toContain('<AuthenticatedNavActions />');
    expect(workspaceShell).toContain('<AuthenticatedNavActions showNotifications');
    expect(inviteShell).toContain('<AuthenticatedNavActions showNotifications');
  });

  it('keeps resource load errors explicit and visually consistent', () => {
    expect(existsSync(projectPath('src/components/states/index.ts'))).toBe(true);
    expect(existsSync(projectPath('src/components/states/error-state.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/states/empty-state.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/states/not-found-state.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/states/resource-load-error.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/states/section-error-state.tsx'))).toBe(true);
    expect(existsSync(projectPath('src/components/error'))).toBe(false);

    const resourceLoadError = readSource('src/components/states/resource-load-error.tsx');
    const statesIndex = readSource('src/components/states/index.ts');
    const localeNotFound = readSource('src/app/[locale]/not-found.tsx');
    const rootNotFound = readSource('src/app/not-found.tsx');
    const localeError = readSource('src/app/[locale]/error.tsx');
    const editorError = readSource('src/app/[locale]/(workspace)/score/[id]/edit/error.tsx');
    const reviewPage = readSource('src/app/[locale]/(app)/review/[jobId]/page.tsx');
    const scorePage = readSource('src/app/[locale]/(app)/score/[id]/page.tsx');
    const editorWorkspace = readSource('src/components/editor/editor-workspace-page.tsx');
    const previewPage = readSource('src/components/external/guest-preview-page.tsx');
    const practicePage = readSource('src/app/[locale]/(workspace)/score/[id]/practice/page.tsx');
    const invitePage = readSource('src/app/[locale]/(invite)/invite/[token]/page.tsx');
    const practiceControls = readSource('src/components/practice/practice-controls.tsx');
    const libraryPage = readSource('src/app/[locale]/(app)/library/page.tsx');
    const notificationDialog = readSource('src/components/notifications/notification-center-dialog.tsx');
    const reviewScoreComparison = readSource('src/components/review/review-score-comparison.tsx');
    const securityPanel = readSource('src/components/settings/security-settings-panel.tsx');
    const sessionsPanel = readSource('src/components/settings/sessions-settings-panel.tsx');
    const alert = readSource('src/components/ui/alert.tsx');

    expect(resourceLoadError).toContain('function ResourceLoadError');
    expect(resourceLoadError).toContain('ErrorState');
    expect(resourceLoadError).toContain('CircleAlert');
    expect(resourceLoadError).toContain('actionHref');
    expect(resourceLoadError).toContain('onAction');
    expect(statesIndex).toContain("export { ResourceLoadError }");
    expect(statesIndex).toContain("export { SectionErrorState }");
    expect(localeNotFound).toContain('NotFoundState');
    expect(rootNotFound).toContain('NotFoundState');
    expect(rootNotFound).not.toContain('style={{');
    expect(localeError).toContain('ErrorState');
    expect(editorError).toContain('ErrorState');
    expect(editorError).not.toContain("process.env.NODE_ENV === 'development'");
    expect(editorError).not.toContain('error.message');
    expect(libraryPage).toContain('EmptyState');
    expect(notificationDialog).toContain('EmptyState');
    expect(notificationDialog).not.toContain('function EmptyState');
    expect(reviewScoreComparison).toContain('EmptyState');
    expect(libraryPage).toContain('SectionErrorState');
    expect(libraryPage).toContain('userFacingErrorMessage');
    expect(libraryPage).toContain('retryScores');
    expect(libraryPage).toContain('void scoresQuery.refetch()');
    expect(libraryPage).toContain('void foldersQuery.refetch()');
    expect(libraryPage).toContain("t('loadFailedDescription')");
    expect(libraryPage).not.toContain('error instanceof Error ? error.message');
    expect(scorePage).not.toContain('resources.scoreError.message');
    expect(alert).toContain('bg-destructive/5');
    expect(notificationDialog).toContain('SectionErrorState');
    expect(notificationDialog).not.toContain('function ErrorState');
    expect(securityPanel).toContain('SectionErrorState');
    expect(sessionsPanel).toContain('SectionErrorState');

    for (const source of [reviewPage, scorePage, editorWorkspace, previewPage, invitePage]) {
      expect(source).toContain('ResourceLoadError');
    }


    expect(practicePage).toContain('workspace.preparedPractice');
    expect(practicePage).toContain("t('setupRequired')");
    expect(practicePage).toContain('canPreparePractice');
    expect(practiceControls).toContain('canPrepareSession');
  });

  it('keeps loading states in shared loading primitives', () => {
    expect(existsSync(projectPath('src/components/loading/index.ts'))).toBe(true);

    for (const loadingComponent of [
      'inline-loading',
      'loading-spinner',
      'page-loading',
      'preview-loading',
      'resource-loading',
      'section-loading',
    ]) {
      expect(existsSync(projectPath(`src/components/loading/${loadingComponent}.tsx`))).toBe(true);
    }

    const globalLoading = readSource('src/app/[locale]/loading.tsx');
    const loadingIndex = readSource('src/components/loading/index.ts');
    const scorePage = readSource('src/app/[locale]/(app)/score/[id]/page.tsx');
    const reviewPage = readSource('src/app/[locale]/(app)/review/[jobId]/page.tsx');
    const editorWorkspace = readSource('src/components/editor/editor-workspace-page.tsx');
    const previewPage = readSource('src/components/external/guest-preview-page.tsx');
    const invitePage = readSource('src/app/[locale]/(invite)/invite/[token]/page.tsx');
    const practicePage = readSource('src/app/[locale]/(workspace)/score/[id]/practice/page.tsx');
    const libraryPage = readSource('src/app/[locale]/(app)/library/page.tsx');
    const librarySidebar = readSource('src/components/library/library-sidebar.tsx');
    const uploadPage = readSource('src/app/[locale]/(app)/upload/page.tsx');
    const loginPage = readSource('src/app/[locale]/(auth)/auth/login/page.tsx');
    const securityPanel = readSource('src/components/settings/security-settings-panel.tsx');
    const scorePreviewViewport = readSource('src/components/score-preview/score-preview-viewport.tsx');
    const practiceScoreViewer = readSource('src/components/practice/practice-score-viewer.tsx');
    const reviewScoreComparison = readSource('src/components/review/review-score-comparison.tsx');

    expect(globalLoading).toContain('<PageLoading');
    expect(loadingIndex).toContain("export { ResourceLoading }");
    expect(loadingIndex).toContain("export { SectionLoading }");
    expect(scorePage).toContain("common('loadingScoreData')");
    expect(reviewPage).toContain("common('loadingReviewData')");
    expect(editorWorkspace).toContain("common('loadingScoreData')");
    expect(previewPage).toContain("t('loading')");
    expect(invitePage).toContain("common('loadingInvite')");
    expect(practicePage).toContain('PracticeScoreViewer');
    expect(libraryPage).toContain("t('loadingScores')");
    expect(librarySidebar).toContain("t('loadingFolders')");
    expect(uploadPage).toContain('<PageLoading');
    expect(loginPage).toContain('InlineLoading');
    expect(securityPanel).toContain('InlineLoading');
    expect(scorePreviewViewport).toContain('PreviewLoading');
    expect(practiceScoreViewer).toContain('PreviewLoading');
    expect(reviewScoreComparison).toContain('PreviewLoading');

    for (const source of [scorePage, reviewPage, editorWorkspace, previewPage, invitePage]) {
      expect(source).toContain('ResourceLoading');
    }

    for (const source of [libraryPage, librarySidebar]) {
      expect(source).toContain('SectionLoading');
    }
  });

  it('keeps retired score preview wrappers out of the shared score components', () => {
    expect(existsSync(projectPath('src/components/score/score-preview-panel.tsx'))).toBe(false);
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

  it('redirects logout and expired sessions through the same returnUrl helper', () => {
    const authContext = readSource('src/contexts/auth-context.tsx');
    const apiClient = readSource('src/lib/api-client.ts');

    expect(authContext).toContain('getCurrentLoginHref');
    expect(authContext).toContain('window.location.assign(getCurrentLoginHref())');
    expect(apiClient).toContain('getCurrentLoginHref');
    expect(apiClient).toContain('window.location.href = getCurrentLoginHref()');
  });
});
