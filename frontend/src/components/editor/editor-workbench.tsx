'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useState } from 'react';
import { EditorSidebar } from '@/components/editor/editor-sidebar';
import { Button } from '@/components/ui/button';
import { useEditorState } from '@/contexts/editor-provider';
import { cn } from '@/lib/utils';
import { EditorWorkbenchCenter } from './editor-workbench-center';
import { EventInspector } from './event-inspector';

interface EditorWorkbenchProps {
  currentXml: string | null;
  onNormalizeVoices: () => void;
}

export function EditorWorkbench({
  currentXml,
  onNormalizeVoices,
}: EditorWorkbenchProps) {
  const { editorMode, selectTool } = useEditorState();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [scoreInspectorOpen, setScoreInspectorOpen] = useState(false);

  return (
    <main className="grow">
      <div className="mx-auto max-w-7xl px-4 pb-16 pt-8">
        <div className="flex items-start gap-6">
          <aside
            className={cn(
              'sticky top-24 hidden h-[calc(100vh-8.5rem)] shrink-0 md:block',
              sidebarOpen ? 'w-64' : 'w-12'
            )}
          >
            <div className="h-full overflow-hidden rounded-2xl bg-white/80 shadow-lg backdrop-blur-sm">
              <div className="flex justify-end border-b p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setSidebarOpen((open) => !open)}
                  aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                >
                  {sidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </Button>
              </div>
              {sidebarOpen ? (
              <div className="h-full overflow-y-auto p-4 hide-scrollbar">
                <EditorSidebar
                  editorMode={editorMode}
                  onToolSelect={selectTool}
                  onNormalizeVoices={onNormalizeVoices}
                />
              </div>
              ) : null}
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <EditorWorkbenchCenter
              currentXml={currentXml}
              onOpenScoreInspector={() => setScoreInspectorOpen(true)}
            />
          </div>

          <EventInspector
            scoreInspectorOpen={scoreInspectorOpen}
            onCloseScoreInspector={() => setScoreInspectorOpen(false)}
          />
        </div>
      </div>
    </main>
  );
}
