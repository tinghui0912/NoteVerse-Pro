'use client';

import { CircleAlert, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/page/page-header';
import { ScoreCapabilityProvider } from '@/components/score/score-capability-context';
import { ScoreSurface } from '@/components/score/score-surface';
import { WorkspaceAccessDenied } from '@/components/score/workspace-access-denied';
import { EditorPageHeader } from '@/components/editor/editor-page-header';
import { EditorPageModals } from '@/components/editor/editor-page-modals';
import { EditorWorkbench } from '@/components/editor/editor-workbench';
import type { ScoreCapabilities } from '@/types/api';
import type { EditorWorkspaceDocument } from '@/types/editor-workspace';

interface EditorWorkspacePageProps {
  document: EditorWorkspaceDocument;
  scoreShell?: {
    scoreId: string;
    capabilities?: ScoreCapabilities;
  };
}

export function EditorWorkspacePage({ document, scoreShell }: EditorWorkspacePageProps) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const router = useRouter();

  const renderFrame = (children: ReactNode) => {
    const content = (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader title={t('title')} description={t('subtitle')} />
        {children}
      </div>
    );

    if (!scoreShell) {
      return content;
    }

    return (
      <ScoreCapabilityProvider
        capabilities={scoreShell.capabilities}
        scoreId={scoreShell.scoreId}
        workspace="edit"
      >
        <ScoreSurface>
          {content}
        </ScoreSurface>
      </ScoreCapabilityProvider>
    );
  };

  if (document.isLoading) {
    return renderFrame(
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-orange-500" />
          <p className="text-gray-600">{common('loading')}</p>
        </div>
      </div>
    );
  }

  if (document.finalLoadError) {
    return renderFrame(
      <div className="flex min-h-[50vh] items-center justify-center py-16">
        <div className="mx-4 w-full max-w-md text-center">
          <CircleAlert className="mx-auto mb-6 h-14 w-14 text-destructive" />
          <h2 className="mb-3 text-2xl font-bold text-gray-900">{common('loadFailed')}</h2>
          <p className="mb-2 text-gray-600">{document.finalLoadError}</p>
          <p className="mb-8 text-sm text-gray-500">{t('loadFailedHint')}</p>
          <Button onClick={() => router.back()} className="px-8">{common('back')}</Button>
        </div>
      </div>
    );
  }

  if (scoreShell && document.scoreCapabilities && !document.scoreCapabilities.can_edit) {
    return renderFrame(
      <WorkspaceAccessDenied
        title={common('accessDenied')}
        description={common('editAccessDeniedDesc')}
        backHref={`/score/${scoreShell.scoreId}`}
        backLabel={common('back')}
      />
    );
  }

  return renderFrame(
    <>
      <div className="flex grow flex-col">
        <EditorPageHeader
          currentXml={document.currentXml}
          fingeringPending={document.fingeringPending}
          isAutoSaving={document.isAutoSaving}
          savePending={document.savePending}
          onGenerateFingering={document.generateFingering}
          onSave={document.save}
          onNormalizeVoices={() => void document.normalizeVoices()}
        />
        <EditorWorkbench
          currentXml={document.currentXml}
          fingeringPending={document.fingeringPending}
          onGenerateFingering={document.generateFingering}
          onNormalizeVoices={() => void document.normalizeVoices()}
        />
      </div>

      <EditorPageModals
        draft={document.pendingDraft ?? null}
        draftOpen={Boolean(document.draftDialogOpen)}
        originalImages={document.originalImages}
        validationOpen={document.validationDialogOpen}
        validationResult={document.validationResult}
        onDiscardDraft={document.discardDraft ?? (async () => undefined)}
        onDraftOpenChange={document.setDraftDialogOpen ?? (() => undefined)}
        onRecoverDraft={document.recoverDraft ?? (async () => undefined)}
        onSaveIgnoringWarnings={document.saveIgnoringWarnings}
        onValidationOpenChange={document.setValidationDialogOpen}
      />
    </>
  );
}
