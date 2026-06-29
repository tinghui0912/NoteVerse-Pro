'use client';

import { CheckCircle2, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { EditorMobileToolSheet } from '@/components/editor/editor-mobile-tool-sheet';
import { EditorToolbar } from '@/components/editor/editor-toolbar';

interface EditorPageHeaderProps {
  currentXml: string | null;
  isAutoSaving: boolean;
  savePending: boolean;
  onSave: () => void;
  onNormalizeVoices: () => void;
}

export function EditorPageHeader({ currentXml, isAutoSaving, savePending, onSave, onNormalizeVoices }: EditorPageHeaderProps) {
  const common = useTranslations('common');

  return (
    <header className="sticky top-0 z-20 h-16 shrink-0 border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4">
        <EditorMobileToolSheet onNormalizeVoices={onNormalizeVoices} />
        <div className="flex items-center gap-2">
          <div className="mr-4 flex items-center gap-2 text-sm text-muted-foreground">
            {isAutoSaving ? <><LoaderCircle className="h-4 w-4 animate-spin" /><span>{common('saving')}</span></> : currentXml ? <><CheckCircle2 className="h-4 w-4 text-green-500" /><span>{common('saved')}</span></> : null}
          </div>
          <EditorToolbar savePending={savePending} onSave={onSave} />
        </div>
      </div>
    </header>
  );
}
