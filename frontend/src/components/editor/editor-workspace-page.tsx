'use client';

import { CircleAlert, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ScoreShell } from '@/components/score-shell/score-shell';
import { WorkspaceAccessDenied } from '@/components/score-shell/workspace-access-denied';
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

function EditorHero({ subtitle }: { subtitle: boolean }) {
  const t = useTranslations('editor');

  return (
    <div className="bg-gray-900">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-32">
        <div className="flex w-full items-center">
          <div className="flex-1 text-center">
            <h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1>
            {subtitle ? <p className="text-lg text-gray-300">{t('subtitle')}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EditorWorkspacePage({ document, scoreShell }: EditorWorkspacePageProps) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const router = useRouter();

  const renderFrame = (children: ReactNode, options?: { footer?: boolean; subtitle?: boolean }) => {
    const hero = <EditorHero subtitle={Boolean(options?.subtitle)} />;
    if (!scoreShell) {
      return (
        <>
          {hero}
          {children}
        </>
      );
    }
    return (
      <ScoreShell
        capabilities={scoreShell.capabilities}
        footer={options?.footer}
        hero={hero}
        scoreId={scoreShell.scoreId}
        workspace="edit"
      >
        {children}
      </ScoreShell>
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
    </>,
    { footer: Boolean(scoreShell), subtitle: true }
  );
}
