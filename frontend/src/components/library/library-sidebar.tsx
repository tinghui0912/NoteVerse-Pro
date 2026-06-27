'use client';

import type { LucideIcon } from 'lucide-react';
import { CircleAlert, Folder, FolderInput, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { LibraryFolder, LibraryView } from '@/types/api';

export interface LibraryVirtualNode {
  view: LibraryView;
  label: string;
  count: number;
  icon: LucideIcon;
}

interface LibrarySidebarProps {
  currentView: LibraryView;
  currentFolderId?: string;
  quickNodes: LibraryVirtualNode[];
  practiceNodes: LibraryVirtualNode[];
  folders: LibraryFolder[];
  folderDepth: (folder: LibraryFolder) => number;
  foldersError: unknown;
  createFolderPending: boolean;
  onCreateFolder: () => void;
  onRetryFolders: () => void;
  onNavigateView: (view: LibraryView) => void;
  onNavigateFolder: (folderId: string) => void;
  onEditFolder: (folder: LibraryFolder) => void;
  onDeleteFolder: (folder: LibraryFolder) => void;
  errorMessage: (error: unknown) => string;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibrarySidebar({
  currentView,
  currentFolderId,
  quickNodes,
  practiceNodes,
  folders,
  folderDepth,
  foldersError,
  createFolderPending,
  onCreateFolder,
  onRetryFolders,
  onNavigateView,
  onNavigateFolder,
  onEditFolder,
  onDeleteFolder,
  errorMessage,
  t,
}: LibrarySidebarProps) {
  return (
    <aside className="space-y-3">
      {foldersError ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>{t('foldersLoadFailed')}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{errorMessage(foldersError)}</p>
            <Button size="sm" variant="outline" onClick={onRetryFolders}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Card className="rounded-2xl">
        <CardContent className="space-y-4 p-3">
          <SidebarNodeGroup
            title={t('quickViews')}
            nodes={quickNodes}
            currentView={currentView}
            currentFolderId={currentFolderId}
            onNavigateView={onNavigateView}
          />
          <SidebarNodeGroup
            title={t('practiceStatus')}
            nodes={practiceNodes}
            currentView={currentView}
            currentFolderId={currentFolderId}
            onNavigateView={onNavigateView}
          />
        </CardContent>
      </Card>
      <Card className="rounded-2xl">
        <CardContent className="p-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-3">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t('folders')}
            </h2>
            <Button
              size="sm"
              variant="outline"
              onClick={onCreateFolder}
              disabled={createFolderPending}
            >
              {t('newFolder')}
            </Button>
          </div>
          <div className="space-y-1">
            {folders.map((folder) => (
              <div
                key={folder.folder_id}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg py-1.5 pr-1 text-left text-sm hover:bg-muted',
                  folder.folder_id === currentFolderId && 'bg-primary/10 text-primary'
                )}
                style={{ paddingLeft: 12 + folderDepth(folder) * 16 }}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                  onClick={() => onNavigateFolder(folder.folder_id)}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="truncate">{folder.name}</span>
                </button>
                <span className="px-2 text-xs text-muted-foreground">
                  {folder.recursive_count}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEditFolder(folder)}>
                      <Pencil className="h-4 w-4" />
                      {t('renameFolder')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onEditFolder(folder)}>
                      <FolderInput className="h-4 w-4" />
                      {t('moveFolder')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDeleteFolder(folder)}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('deleteFolder')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </aside>
  );
}
interface SidebarNodeGroupProps {
  title: string;
  nodes: LibraryVirtualNode[];
  currentView: LibraryView;
  currentFolderId?: string;
  onNavigateView: (view: LibraryView) => void;
}

function SidebarNodeGroup({
  title,
  nodes,
  currentView,
  currentFolderId,
  onNavigateView,
}: SidebarNodeGroupProps) {
  return (
    <div>
      <h2 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="space-y-1">
        {nodes.map((node) => {
          const Icon = node.icon;
          return (
            <button
              key={node.view}
              className={cn(
                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                !currentFolderId && currentView === node.view
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-muted'
              )}
              onClick={() => onNavigateView(node.view)}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {node.label}
              </span>
              <span>{node.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

