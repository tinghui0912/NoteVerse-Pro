'use client';

import { CheckCircle2, Eye, ImageIcon, Loader2, LoaderCircle, PanelLeft, Redo, Save, Undo } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { EditorSidebar } from '@/components/editor/editor-sidebar';
import { useEditorState, useHistoryEditor } from '@/contexts/editor-provider';

interface EditorPageHeaderProps {
  currentXml: string | null;
  isAutoSaving: boolean;
  savePending: boolean;
  onSave: () => void;
  onPreview: () => void;
  onMergeParts: () => void;
}

export function EditorPageHeader({ currentXml, isAutoSaving, savePending, onSave, onPreview, onMergeParts }: EditorPageHeaderProps) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const { editorMode, selectTool, setIsImageViewerOpen } = useEditorState();
  const { canUndo, canRedo, handleUndo, handleRedo } = useHistoryEditor();
  const items = [
    { label: 'saveChanges', icon: Save, onClick: onSave, disabled: savePending, loading: savePending },
    { label: 'undo', icon: Undo, onClick: handleUndo, disabled: !canUndo },
    { label: 'redo', icon: Redo, onClick: handleRedo, disabled: !canRedo },
    { label: 'originalScore', icon: ImageIcon, onClick: () => setIsImageViewerOpen((open) => !open), disabled: false },
  ];

  return (
    <header className="sticky top-0 z-20 h-16 shrink-0 border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-4">
        <Sheet>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="md:hidden"><PanelLeft className="h-5 w-5" /></Button></SheetTrigger>
          <SheetContent side="left" className="w-72 rounded-r-2xl bg-white/80 p-4 backdrop-blur-sm">
            <SheetHeader className="sr-only"><SheetTitle>{t('title')}</SheetTitle></SheetHeader>
            <div className="h-full overflow-y-auto pt-12 hide-scrollbar"><EditorSidebar editorMode={editorMode} onToolSelect={selectTool} onMergeParts={onMergeParts} /></div>
          </SheetContent>
        </Sheet>
        <div className="flex items-center gap-2">
          <div className="mr-4 flex items-center gap-2 text-sm text-muted-foreground">
            {isAutoSaving ? <><LoaderCircle className="h-4 w-4 animate-spin" /><span>{common('saving')}</span></> : currentXml ? <><CheckCircle2 className="h-4 w-4 text-green-500" /><span>{common('saved')}</span></> : null}
          </div>
          <TooltipProvider>
            {items.map((item) => (
              <Tooltip key={item.label}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={item.onClick} disabled={item.disabled}>
                    {item.loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <item.icon className="h-5 w-5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent><p>{t(item.label as never)}</p></TooltipContent>
              </Tooltip>
            ))}
            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost" size="icon" onClick={onPreview}><Eye className="h-5 w-5" /></Button></TooltipTrigger>
              <TooltipContent><p>{t('livePreview')}</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </header>
  );
}
