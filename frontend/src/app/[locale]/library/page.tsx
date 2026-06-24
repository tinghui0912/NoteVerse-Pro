'use client';

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Folder,
  FolderInput,
  CircleAlert,
  Loader2,
  MoreHorizontal,
  MoveRight,
  Music,
  Pencil,
  Star,
  Target,
  Trash2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Footer } from '@/components/layout/footer';
import {
  useCreateLibraryFolder,
  useDeleteLibraryFolder,
  useLibraryEntries,
  useLibraryFolders,
  useMoveLibraryEntries,
  useUpdateLibraryFolder,
  useUpdateLibraryEntry,
} from '@/hooks/queries/use-library-queries';
import { formatApiDateTime } from '@/lib/score/metadata-display';
import { cn } from '@/lib/utils';
import type { FolderDeleteMode, LibraryFolder, LibraryPracticeState, LibraryView } from '@/types/api';

const ROOT_FOLDER_VALUE = '__root__';
const LIBRARY_VIEWS = [
  'all',
  'favorites',
  'recent_practice',
  'to_practice',
  'mastered',
  'bookmarks',
  'archived',
  'trash',
] as const satisfies readonly LibraryView[];

type FolderFormState =
  | { mode: 'create'; folder: null }
  | { mode: 'edit'; folder: LibraryFolder };

function folderDepth(folder: LibraryFolder, folders: LibraryFolder[]) {
  let depth = 0;
  let parentId = folder.parent_folder_id;
  while (parentId) {
    const parent = folders.find((item) => item.folder_id === parentId);
    if (!parent) break;
    depth += 1;
    parentId = parent.parent_folder_id;
  }
  return depth;
}

function folderDescendantIds(folder: LibraryFolder, folders: LibraryFolder[]) {
  const result = new Set<string>();
  const visit = (parentId: string) => {
    for (const item of folders) {
      if (item.parent_folder_id === parentId) {
        result.add(item.folder_id);
        visit(item.folder_id);
      }
    }
  };
  visit(folder.folder_id);
  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeLibraryView(value: string | undefined): LibraryView {
  return LIBRARY_VIEWS.includes(value as LibraryView) ? (value as LibraryView) : 'all';
}

export default function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    folder?: string;
    search?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const params = React.use(searchParams);
  const t = useTranslations('library');
  const router = useRouter();
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>(ROOT_FOLDER_VALUE);
  const [folderForm, setFolderForm] = useState<FolderFormState | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderParentId, setFolderParentId] = useState<string>(ROOT_FOLDER_VALUE);
  const [deleteTarget, setDeleteTarget] = useState<LibraryFolder | null>(null);
  const [deleteMode, setDeleteMode] = useState<FolderDeleteMode>('MOVE_CONTENTS_TO_PARENT');
  const createFolder = useCreateLibraryFolder();
  const updateFolder = useUpdateLibraryFolder();
  const deleteFolder = useDeleteLibraryFolder();
  const moveEntries = useMoveLibraryEntries();
  const updateEntry = useUpdateLibraryEntry();
  const view = normalizeLibraryView(params.view);
  const folderId = params.folder;
  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = 20;
  const foldersQuery = useLibraryFolders();
  const entriesQuery = useLibraryEntries({
    view,
    folderId,
    search: params.search,
    sort: params.sort === 'name_asc' ? 'name_asc' : 'updated_desc',
    page,
    pageSize,
  });
  const folders = useMemo(
    () => foldersQuery.data?.data?.folders ?? [],
    [foldersQuery.data?.data?.folders]
  );
  const entries = entriesQuery.data?.data ?? [];
  const pagination = entriesQuery.data?.pagination;
  const selectedFolder = folders.find((folder) => folder.folder_id === folderId);
  const selectedEntrySet = useMemo(() => new Set(selectedEntryIds), [selectedEntryIds]);
  const mutationError =
    createFolder.error ?? updateFolder.error ?? deleteFolder.error ?? moveEntries.error ?? updateEntry.error;
  const folderTree = foldersQuery.data?.data;
  const virtualNodes = [
    {
      view: 'all' as const,
      label: t('allScores'),
      count: folderTree?.all_count ?? 0,
      icon: Music,
    },
    {
      view: 'recent_practice' as const,
      label: t('recentPractice'),
      count: folderTree?.recent_practice_count ?? 0,
      icon: Clock3,
    },
    {
      view: 'favorites' as const,
      label: t('favorites'),
      count: folderTree?.favorite_count ?? 0,
      icon: Star,
    },
    {
      view: 'to_practice' as const,
      label: t('toPractice'),
      count: folderTree?.to_practice_count ?? 0,
      icon: Target,
    },
    {
      view: 'mastered' as const,
      label: t('mastered'),
      count: folderTree?.mastered_count ?? 0,
      icon: CheckCircle2,
    },
  ];

  const sortedFolders = useMemo(
    () =>
      [...folders].sort((a, b) => {
        const depthDelta = folderDepth(a, folders) - folderDepth(b, folders);
        if (depthDelta !== 0) return depthDelta;
        return a.position - b.position || a.name.localeCompare(b.name);
      }),
    [folders]
  );
  const selectableParentFolders = useMemo(() => {
    if (!folderForm || folderForm.mode === 'create') return sortedFolders;
    const excludedIds = folderDescendantIds(folderForm.folder, folders);
    excludedIds.add(folderForm.folder.folder_id);
    return sortedFolders.filter((folder) => !excludedIds.has(folder.folder_id));
  }, [folderForm, sortedFolders, folders]);

  const navigate = (next: { view?: LibraryView; folder?: string | null; page?: number }) => {
    const query = new URLSearchParams();
    if (next.folder) query.set('folder', next.folder);
    else query.set('view', next.view ?? 'all');
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    if (next.page && next.page > 1) query.set('page', String(next.page));
    router.push(`/library?${query.toString()}`);
  };
  const openCreateFolderDialog = () => {
    setFolderForm({ mode: 'create', folder: null });
    setFolderName('');
    setFolderParentId(folderId ?? ROOT_FOLDER_VALUE);
  };
  const openEditFolderDialog = (folder: LibraryFolder) => {
    setFolderForm({ mode: 'edit', folder });
    setFolderName(folder.name);
    setFolderParentId(folder.parent_folder_id ?? ROOT_FOLDER_VALUE);
  };
  const closeFolderDialog = () => {
    setFolderForm(null);
    setFolderName('');
    setFolderParentId(ROOT_FOLDER_VALUE);
  };
  const submitFolderForm = () => {
    const name = folderName.trim();
    if (!folderForm || !name) return;
    const parent_folder_id = folderParentId === ROOT_FOLDER_VALUE ? null : folderParentId;
    if (folderForm.mode === 'create') {
      createFolder.mutate(
        { name, parent_folder_id },
        { onSuccess: closeFolderDialog }
      );
      return;
    }
    updateFolder.mutate(
      {
        folderId: folderForm.folder.folder_id,
        name,
        parent_folder_id,
      },
      { onSuccess: closeFolderDialog }
    );
  };
  const confirmDeleteFolder = () => {
    if (!deleteTarget) return;
    const deletedIds = folderDescendantIds(deleteTarget, folders);
    deletedIds.add(deleteTarget.folder_id);
    deleteFolder.mutate(
      { folderId: deleteTarget.folder_id, mode: deleteMode },
      {
        onSuccess: () => {
          if (folderId && deletedIds.has(folderId)) navigate({ view: 'all', folder: null });
          setDeleteTarget(null);
        },
      }
    );
  };
  const toggleEntrySelection = (entryId: string, checked: boolean) => {
    setSelectedEntryIds((current) =>
      checked ? [...current, entryId] : current.filter((id) => id !== entryId)
    );
  };
  const clearSelection = () => setSelectedEntryIds([]);
  const moveSelectedEntries = () => {
    if (!selectedEntryIds.length) return;
    moveEntries.mutate(
      {
        entry_ids: selectedEntryIds,
        target_folder_id: moveTargetFolderId === ROOT_FOLDER_VALUE ? null : moveTargetFolderId,
      },
      { onSuccess: clearSelection }
    );
  };
  const updatePracticeState = (entryId: string, practiceState: LibraryPracticeState) => {
    updateEntry.mutate({ entryId, practice_state: practiceState });
  };
  const viewTitle = selectedFolder?.name ?? {
    all: t('allScores'),
    favorites: t('favorites'),
    recent_practice: t('recentPractice'),
    to_practice: t('toPractice'),
    mastered: t('mastered'),
    bookmarks: t('bookmarks'),
    archived: t('archived'),
    trash: t('trash'),
  }[view];
  const practiceStateLabel = (practiceState: LibraryPracticeState) =>
    ({
      TO_PRACTICE: t('practiceStateToPractice'),
      IN_PROGRESS: t('practiceStateInProgress'),
      MASTERED: t('practiceStateMastered'),
    })[practiceState];
  const retryLibraryData = () => {
    void foldersQuery.refetch();
    void entriesQuery.refetch();
  };
  const emptyMessages: Partial<Record<LibraryView, string>> = {
    favorites: t('emptyFavorites'),
    recent_practice: t('emptyRecentPractice'),
    to_practice: t('emptyToPractice'),
    mastered: t('emptyMastered'),
  };
  const emptyMessage = params.search
    ? t('emptySearch')
    : folderId
      ? t('emptyFolder')
      : (emptyMessages[view] ?? t('empty'));

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-28">
          <h1 className="text-4xl font-bold text-white sm:text-5xl">{t('title')}</h1>
          <p className="mt-3 text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>
      <main className="grow">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-10 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3">
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={openCreateFolderDialog}
              disabled={createFolder.isPending}
            >
              {t('newFolder')}
            </Button>
            {foldersQuery.isError ? (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>{t('foldersLoadFailed')}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{errorMessage(foldersQuery.error)}</p>
                  <Button size="sm" variant="outline" onClick={() => void foldersQuery.refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : null}
            <Card className="rounded-2xl">
              <CardContent className="space-y-1 p-3">
                {virtualNodes.map((node) => {
                  const Icon = node.icon;
                  return (
                    <button
                      key={node.view}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                        !folderId && view === node.view
                          ? 'bg-primary/10 text-primary'
                          : 'hover:bg-muted'
                      )}
                      onClick={() => navigate({ view: node.view, folder: null })}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {node.label}
                      </span>
                      <span>{node.count}</span>
                    </button>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardContent className="p-3">
                <h2 className="mb-2 px-3 text-sm font-semibold text-muted-foreground">
                  {t('folders')}
                </h2>
                <div className="space-y-1">
                  {sortedFolders.map((folder) => (
                    <div
                      key={folder.folder_id}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg py-1.5 pr-1 text-left text-sm hover:bg-muted',
                        folder.folder_id === folderId && 'bg-primary/10 text-primary'
                      )}
                      style={{ paddingLeft: 12 + folderDepth(folder, folders) * 16 }}
                    >
                      <button
                        className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                        onClick={() => navigate({ folder: folder.folder_id })}
                      >
                        <Folder className="h-4 w-4 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </button>
                      <span className="px-2 text-xs text-muted-foreground">{folder.recursive_count}</span>
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
                          <DropdownMenuItem onClick={() => openEditFolderDialog(folder)}>
                            <Pencil className="h-4 w-4" />
                            {t('renameFolder')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEditFolderDialog(folder)}>
                            <FolderInput className="h-4 w-4" />
                            {t('moveFolder')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(folder)}
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
          <section>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-bold">
                  {viewTitle}
                </h2>
                {pagination ? (
                  <p className="text-sm text-muted-foreground">
                    {t('totalScores', { count: pagination.total })}
                  </p>
                ) : null}
              </div>
              <Button onClick={() => router.push('/upload')}>{t('uploadScore')}</Button>
            </div>
            {mutationError ? (
              <Alert variant="destructive" className="mb-5">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>{t('operationFailed')}</AlertTitle>
                <AlertDescription>{errorMessage(mutationError)}</AlertDescription>
              </Alert>
            ) : null}
            {selectedEntryIds.length ? (
              <Card className="mb-5 rounded-2xl">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MoveRight className="h-4 w-4" />
                    {t('selectedCount', { count: selectedEntryIds.length })}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select value={moveTargetFolderId} onValueChange={setMoveTargetFolderId}>
                      <SelectTrigger className="w-full sm:w-56">
                        <SelectValue placeholder={t('moveTargetPlaceholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ROOT_FOLDER_VALUE}>{t('libraryRoot')}</SelectItem>
                        {sortedFolders.map((folder) => (
                          <SelectItem key={folder.folder_id} value={folder.folder_id}>
                            {folder.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={moveSelectedEntries} disabled={moveEntries.isPending}>
                      {t('moveSelected')}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={clearSelection}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            {entriesQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : entriesQuery.isError ? (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>{t('entriesLoadFailed')}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{errorMessage(entriesQuery.error)}</p>
                  <Button size="sm" variant="outline" onClick={retryLibraryData}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {t('retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            ) : entries.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {entries.map((entry) => (
                  <Card
                    key={entry.entry_id}
                    className={cn(
                      'cursor-pointer rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg',
                      !entry.available && 'cursor-not-allowed opacity-60'
                    )}
                    onClick={() =>
                      entry.available &&
                      router.push(
                        `/results/${entry.score_id}?from=${
                          entry.source_type === 'BOOKMARK' ? 'shares' : 'my-scores'
                        }`
                      )
                    }
                  >
                    <CardContent className="p-5">
                      <div className="mb-3 flex justify-end">
                        <Checkbox
                          checked={selectedEntrySet.has(entry.entry_id)}
                          onClick={(event) => event.stopPropagation()}
                          onCheckedChange={(checked) =>
                            toggleEntrySelection(entry.entry_id, checked === true)
                          }
                          aria-label={t('selectScore', { title: entry.title })}
                        />
                      </div>
                      <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-muted">
                        <Music className="h-10 w-10 text-muted-foreground" />
                      </div>
                      <h3 className="truncate font-semibold">{entry.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatApiDateTime(entry.updated_at)}
                      </p>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                          {practiceStateLabel(entry.practice_state)}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              disabled={updateEntry.isPending}
                              onClick={(event) => event.stopPropagation()}
                            >
                              {t('changePracticeState')}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <DropdownMenuItem
                              onClick={() =>
                                updatePracticeState(entry.entry_id, 'TO_PRACTICE')
                              }
                            >
                              <Target className="h-4 w-4" />
                              {t('practiceStateToPractice')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                updatePracticeState(entry.entry_id, 'IN_PROGRESS')
                              }
                            >
                              <Clock3 className="h-4 w-4" />
                              {t('practiceStateInProgress')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => updatePracticeState(entry.entry_id, 'MASTERED')}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              {t('practiceStateMastered')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{entry.source_type === 'BOOKMARK' ? t('bookmark') : t('libraryEntry')}</span>
                        {!entry.available ? <span>{t('unavailable')}</span> : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="rounded-2xl">
                <CardContent className="py-20 text-center">
                  <Music className="mx-auto mb-4 h-14 w-14 text-muted-foreground" />
                  <p className="text-muted-foreground">{emptyMessage}</p>
                  {!folderId && view === 'all' && !params.search ? (
                    <Button className="mt-4" onClick={() => router.push('/upload')}>
                      {t('uploadScore')}
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>
      <Dialog open={folderForm !== null} onOpenChange={(open) => !open && closeFolderDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {folderForm?.mode === 'edit' ? t('editFolderTitle') : t('createFolderTitle')}
            </DialogTitle>
            <DialogDescription>
              {folderForm?.mode === 'edit'
                ? t('editFolderDescription')
                : t('createFolderDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="library-folder-name">
                {t('folderNameLabel')}
              </label>
              <Input
                id="library-folder-name"
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder={t('folderNamePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="library-folder-parent">
                {t('parentFolderLabel')}
              </label>
              <Select value={folderParentId} onValueChange={setFolderParentId}>
                <SelectTrigger id="library-folder-parent">
                  <SelectValue placeholder={t('moveTargetPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ROOT_FOLDER_VALUE}>{t('libraryRoot')}</SelectItem>
                  {selectableParentFolders.map((folder) => (
                    <SelectItem key={folder.folder_id} value={folder.folder_id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeFolderDialog}>
              {t('cancel')}
            </Button>
            <Button
              onClick={submitFolderForm}
              disabled={
                !folderName.trim() || createFolder.isPending || updateFolder.isPending
              }
            >
              {folderForm?.mode === 'edit' ? t('saveFolder') : t('createFolder')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteFolderTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? t('deleteFolderDescription', { name: deleteTarget.name }) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="library-delete-mode">
              {t('deleteModeLabel')}
            </label>
            <Select
              value={deleteMode}
              onValueChange={(value) => setDeleteMode(value as FolderDeleteMode)}
            >
              <SelectTrigger id="library-delete-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MOVE_CONTENTS_TO_PARENT">
                  {t('deleteModeMoveToParent')}
                </SelectItem>
                <SelectItem value="MOVE_CONTENTS_TO_ROOT">
                  {t('deleteModeMoveToRoot')}
                </SelectItem>
                <SelectItem value="TRASH_CONTENTS">
                  {t('deleteModeTrashContents')}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDeleteFolder}
              disabled={deleteFolder.isPending}
            >
              {t('deleteFolder')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Footer />
    </div>
  );
}
