'use client';

import { PanelLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useEditorState } from '@/contexts/editor-provider';
import type { FingeringRequest } from '@/generated/api';
import { EditorSidebar } from './editor-sidebar';

interface EditorMobileToolSheetProps {
  fingeringPending?: boolean;
  onGenerateFingering?: (handSize: NonNullable<FingeringRequest['hand_size']>) => void;
  onNormalizeVoices: () => void;
}

export function EditorMobileToolSheet({ fingeringPending, onGenerateFingering, onNormalizeVoices }: EditorMobileToolSheetProps) {
  const t = useTranslations('editor');
  const { editorMode, selectTool } = useEditorState();

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <PanelLeft className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 rounded-r-2xl bg-white/80 p-4 backdrop-blur-sm">
        <SheetHeader className="sr-only">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        <div className="h-full overflow-y-auto pt-12 hide-scrollbar">
          <EditorSidebar
            editorMode={editorMode}
            fingeringPending={fingeringPending}
            onGenerateFingering={onGenerateFingering}
            onToolSelect={selectTool}
            onNormalizeVoices={onNormalizeVoices}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
