'use client';

import { Suspense, useState } from 'react';
import { ArrowLeft, CircleAlert, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { notFound, useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { CardBasedEditor } from '@/components/editor/card-based-editor';
import { EditorPageHeader } from '@/components/editor/editor-page-header';
import { EditorPageModals } from '@/components/editor/editor-page-modals';
import { EditorSidebar } from '@/components/editor/editor-sidebar';
import { ScoreInfoCard } from '@/components/editor/score-info-card';
import { EditorProvider, useEditorState } from '@/contexts/editor-provider';
import { useEditorDocument } from '@/hooks/editor/use-editor-document';

function EditorPageContent({ id, returnUrl }: { id: string; returnUrl?: string }) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const router = useRouter();
  const document = useEditorDocument({ id, returnUrl });
  const { editorMode, selectTool } = useEditorState();
  const [listenOpen, setListenOpen] = useState(false);

  if (document.isLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>
        <main className="flex grow items-center justify-center"><div className="text-center"><Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-orange-500" /><p className="text-gray-600">{common('loading')}</p></div></main>
        <Footer />
      </div>
    );
  }

  if (document.finalLoadError) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>
        <main className="flex grow items-center justify-center py-16">
          <div className="mx-4 w-full max-w-md text-center"><CircleAlert className="mx-auto mb-6 h-14 w-14 text-destructive" /><h2 className="mb-3 text-2xl font-bold text-gray-900">{common('loadFailed')}</h2><p className="mb-2 text-gray-600">{document.finalLoadError}</p><p className="mb-8 text-sm text-gray-500">{t('loadFailedHint')}</p><Button onClick={() => router.back()} className="px-8">{common('back')}</Button></div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-32">
          <div className="flex w-full items-center">
            <div className="w-12 shrink-0"><Button variant="ghost" onClick={() => router.back()} className="h-12 w-12 rounded-full text-white hover:bg-white/10 hover:text-white [&_svg]:size-6"><ArrowLeft /></Button></div>
            <div className="flex-1 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1><p className="text-lg text-gray-300">{t('subtitle')}</p></div>
            <div className="w-12 shrink-0" />
          </div>
        </div>
      </div>

      <div className="flex grow flex-col">
        <EditorPageHeader
          currentXml={document.currentXml}
          isAutoSaving={document.isAutoSaving}
          savePending={document.savePending}
          onSave={document.save}
          onPreview={() => document.currentXml && setListenOpen(true)}
          onMergeParts={() => void document.mergeParts()}
        />
        <main className="grow">
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-8">
            <div className="flex items-start gap-8">
              <aside className="sticky top-24 hidden h-[calc(100vh-8.5rem)] w-64 shrink-0 md:block">
                <div className="h-full overflow-hidden rounded-2xl bg-white/80 shadow-lg backdrop-blur-sm"><div className="h-full overflow-y-auto p-4 hide-scrollbar"><EditorSidebar editorMode={editorMode} onToolSelect={selectTool} onMergeParts={() => void document.mergeParts()} /></div></div>
              </aside>
              <div className="min-w-0 flex-1"><div className="flex flex-col gap-4"><ScoreInfoCard /><CardBasedEditor /></div></div>
            </div>
          </div>
        </main>
      </div>

      <Footer />
      <EditorPageModals
        draft={document.pendingDraft}
        draftOpen={document.draftDialogOpen}
        listenOpen={listenOpen}
        originalImages={document.originalImages}
        previewXml={document.currentXml}
        validationOpen={document.validationDialogOpen}
        validationResult={document.validationResult}
        onDiscardDraft={document.discardDraft}
        onDraftOpenChange={document.setDraftDialogOpen}
        onListenOpenChange={setListenOpen}
        onRecoverDraft={document.recoverDraft}
        onSaveIgnoringWarnings={document.saveIgnoringWarnings}
        onValidationOpenChange={document.setValidationDialogOpen}
      />
    </div>
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
