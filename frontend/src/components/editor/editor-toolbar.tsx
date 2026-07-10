'use client';

import { ImageIcon, Redo, Save, Undo } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { InlineLoading } from '@/components/loading/inline-loading';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useEditorState, useHistoryEditor } from '@/contexts/editor-provider';

interface EditorToolbarProps {
  savePending: boolean;
  onSave: () => void;
}

export function EditorToolbar({ savePending, onSave }: EditorToolbarProps) {
  const t = useTranslations('editor');
  const { setIsImageViewerOpen } = useEditorState();
  const { canUndo, canRedo, handleUndo, handleRedo } = useHistoryEditor();

  const items = [
    { label: 'saveChanges', icon: Save, onClick: onSave, disabled: savePending, loading: savePending },
    { label: 'undo', icon: Undo, onClick: handleUndo, disabled: !canUndo },
    { label: 'redo', icon: Redo, onClick: handleRedo, disabled: !canRedo },
    { label: 'originalScore', icon: ImageIcon, onClick: () => setIsImageViewerOpen((open) => !open), disabled: false },
  ];

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {items.map((item) => (
            <Tooltip key={item.label}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={item.onClick} disabled={item.disabled}>
                {item.loading ? <InlineLoading /> : <item.icon className="h-5 w-5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t(item.label as never)}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
