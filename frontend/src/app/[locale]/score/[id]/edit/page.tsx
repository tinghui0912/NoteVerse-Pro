'use client';

import { Suspense } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { notFound, useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { EditorPageHeader } from '@/components/editor/editor-page-header';
import { EditorPageModals } from '@/components/editor/editor-page-modals';
import { EditorWorkbench } from '@/components/editor/editor-workbench';
import { ScoreShell } from '@/components/score-shell/score-shell';
import { WorkspaceAccessDenied } from '@/components/score-shell/workspace-access-denied';
import { EditorProvider } from '@/contexts/editor-provider';
import { useEditorDocument } from '@/hooks/editor/use-editor-document';

function EditorPageContent({ id, returnUrl }: { id: string; returnUrl?: string }) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const router = useRouter();
  const document = useEditorDocument({ id, returnUrl });

  if (document.isLoading) {
    return (
      <ScoreShell hero={<div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>} scoreId={id} workspace="edit">
        <div className="flex min-h-[50vh] items-center justify-center"><div className="text-center"><Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-orange-500" /><p className="text-gray-600">{common('loading')}</p></div></div>
      </ScoreShell>
    );
  }

  if (document.finalLoadError) {
    return (
      <ScoreShell hero={<div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>} scoreId={id} workspace="edit">
        <div className="flex min-h-[50vh] items-center justify-center py-16">
          <div className="mx-4 w-full max-w-md text-center"><CircleAlert className="mx-auto mb-6 h-14 w-14 text-destructive" /><h2 className="mb-3 text-2xl font-bold text-gray-900">{common('loadFailed')}</h2><p className="mb-2 text-gray-600">{document.finalLoadError}</p><p className="mb-8 text-sm text-gray-500">{t('loadFailedHint')}</p><Button onClick={() => router.back()} className="px-8">{common('back')}</Button></div>
        </div>
      </ScoreShell>
    );
  }

  if (document.scoreCapabilities && !document.scoreCapabilities.can_edit) {
    return (
      <ScoreShell capabilities={document.scoreCapabilities} hero={<div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>} scoreId={id} workspace="edit">
        <WorkspaceAccessDenied
          title={common('accessDenied')}
          description={common('editAccessDeniedDesc')}
          backHref={`/score/${id}`}
          backLabel={common('back')}
        />
      </ScoreShell>
    );
  }

  return (
    <ScoreShell
      capabilities={document.scoreCapabilities}
      footer
      hero={<div className="bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-32">
          <div className="flex w-full items-center">
            <div className="flex-1 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1><p className="text-lg text-gray-300">{t('subtitle')}</p></div>
          </div>
        </div>
      </div>}
      scoreId={id}
      workspace="edit"
    >

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
        draft={document.pendingDraft}
        draftOpen={document.draftDialogOpen}
        originalImages={document.originalImages}
        validationOpen={document.validationDialogOpen}
        validationResult={document.validationResult}
        onDiscardDraft={document.discardDraft}
        onDraftOpenChange={document.setDraftDialogOpen}
        onRecoverDraft={document.recoverDraft}
        onSaveIgnoringWarnings={document.saveIgnoringWarnings}
        onValidationOpenChange={document.setValidationDialogOpen}
      />
    </ScoreShell>
  );
}

export default function EditorPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const returnUrl = searchParams.get('returnUrl') || undefined;

  if (!id) {
    notFound();
  }

  return (
    <Suspense fallback={null}>
      <EditorProvider><EditorPageContent id={id} returnUrl={returnUrl} /></EditorProvider>
    </Suspense>
  );
}
