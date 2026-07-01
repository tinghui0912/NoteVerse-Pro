'use client';

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  CircleAlert,
  Loader2,
  Music,
  Star,
  Target,
  RefreshCw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LibraryBulkActions } from '@/components/library/library-bulk-actions';
import { LibraryDeleteFolderDialog } from '@/components/library/library-delete-folder-dialog';
import { LibraryEntryCard } from '@/components/library/library-entry-card';
import {
  LibraryDeleteEntriesDialog,
  LibraryMoveEntriesDialog,
  LibraryPracticeStateDialog,
} from '@/components/library/library-entry-action-dialogs';
import { LibraryFilterBar } from '@/components/library/library-filter-bar';
import { LibraryFolderDialog } from '@/components/library/library-folder-dialog';
import { LibraryPagination } from '@/components/library/library-pagination';
import { LibrarySidebar } from '@/components/library/library-sidebar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Footer } from '@/components/layout/footer';
import {
  useCreateLibraryFolder,
  useDeleteLibraryFolder,
  useLibraryEntries,
  useLibraryFolders,
  useMoveLibraryEntries,
  useSetLibraryEntriesPracticeState,
  useTrashLibraryEntries,
  useUpdateLibraryFolder,
} from '@/hooks/queries/use-library-queries';
import {
  folderDepth,
  folderDescendantIds,
  folderLevel,
  folderSubtreeHeight,
  MAX_LIBRARY_FOLDER_LEVEL,
  normalizeLibraryView,
  sortedLibraryFolders,
} from '@/lib/library/folder-tree';
import {
  buildLibraryHref,
  normalizeLibrarySort,
  normalizePage,
} from '@/lib/library/state';
import type { FolderDeleteMode, LibraryEntry, LibraryFolder, LibraryPracticeState, LibraryView, UserSettableLibraryPracticeState } from '@/types/api';

const ROOT_FOLDER_VALUE = '__root__';

type FolderFormState =
  | { mode: 'create'; folder: null }
  | { mode: 'edit'; folder: LibraryFolder };

type EntryActionState =
  | { type: 'practice'; entry: LibraryEntry | null }
  | { type: 'move'; entry: LibraryEntry | null }
  | { type: 'delete'; entry: LibraryEntry | null }
  | null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const [batchMode, setBatchMode] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([]);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>(ROOT_FOLDER_VALUE);
  const [folderForm, setFolderForm] = useState<FolderFormState | null>(null);
  const [folderName, setFolderName] = useState('');
  const [folderParentId, setFolderParentId] = useState<string>(ROOT_FOLDER_VALUE);
  const [deleteTarget, setDeleteTarget] = useState<LibraryFolder | null>(null);
  const [deleteMode, setDeleteMode] = useState<FolderDeleteMode>('MOVE_CONTENTS_TO_PARENT');
  const [searchInput, setSearchInput] = useState(params.search ?? '');
  const [entryAction, setEntryAction] = useState<EntryActionState>(null);
  const [practiceState, setPracticeState] = useState<UserSettableLibraryPracticeState>('TO_PRACTICE');
  const createFolder = useCreateLibraryFolder();
  const updateFolder = useUpdateLibraryFolder();
  const deleteFolder = useDeleteLibraryFolder();
  const moveEntries = useMoveLibraryEntries();
  const setEntriesPracticeState = useSetLibraryEntriesPracticeState();
  const trashEntries = useTrashLibraryEntries();
  const view = normalizeLibraryView(params.view);
  const folderId = params.folder;
  const page = normalizePage(params.page);
  const pageSize = 20;
  const foldersQuery = useLibraryFolders();
  const entriesQuery = useLibraryEntries({
    view,
    folderId,
    search: params.search,
    sort: normalizeLibrarySort(params.sort),
    page,
    pageSize,
  });
  const folders = useMemo(
    () => foldersQuery.data?.data?.folders ?? [],
    [foldersQuery.data?.data?.folders]
  );
  const entries = useMemo(
    () => entriesQuery.data?.data ?? [],
    [entriesQuery.data?.data]
  );
  const pagination = entriesQuery.data?.pagination;
  const canGoPrevious = pagination ? pagination.page > 1 : false;
  const canGoNext = pagination ? pagination.page < pagination.total_pages : false;
  const selectedFolder = folders.find((folder) => folder.folder_id === folderId);
  const selectedEntrySet = useMemo(() => new Set(selectedEntryIds), [selectedEntryIds]);
  const visibleEntryIds = useMemo(() => entries.map((entry) => entry.entry_id), [entries]);
  const allVisibleSelected =
    visibleEntryIds.length > 0 && visibleEntryIds.every((entryId) => selectedEntrySet.has(entryId));
  const mutationError =
    createFolder.error ??
    updateFolder.error ??
    deleteFolder.error ??
    moveEntries.error ??
    trashEntries.error ??
    setEntriesPracticeState.error;
  const folderTree = foldersQuery.data?.data;
  const quickNodes = [
    {
      view: 'all' as const,
      label: t('allScores'),
      count: folderTree?.all_count ?? 0,
      icon: Music,
    },
    {
      view: 'favorites' as const,
      label: t('favorites'),
      count: folderTree?.favorite_count ?? 0,
      icon: Star,
    },
  ];

  const practiceNodes = [
    {
      view: 'recent_practice' as const,
      label: t('recentPractice'),
      count: folderTree?.recent_practice_count ?? 0,
      icon: Clock3,
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
    () => sortedLibraryFolders(folders),
    [folders]
  );
  const selectableParentFolders = useMemo(() => {
    if (!folderForm || folderForm.mode === 'create') {
      return sortedFolders.filter(
        (folder) => folderLevel(folder, folders) < MAX_LIBRARY_FOLDER_LEVEL
      );
    }
    const excludedIds = folderDescendantIds(folderForm.folder, folders);
    excludedIds.add(folderForm.folder.folder_id);
    const subtreeHeight = folderSubtreeHeight(folderForm.folder, folders);
    return sortedFolders.filter(
      (folder) =>
        !excludedIds.has(folder.folder_id) &&
        folderDepth(folder, folders) + subtreeHeight < MAX_LIBRARY_FOLDER_LEVEL
    );
  }, [folderForm, sortedFolders, folders]);

  const navigate = (next: { view?: LibraryView; folder?: string | null; page?: number }) => {
    router.push(
      buildLibraryHref(
        { view, folderId, search: params.search, sort: params.sort },
        next
      )
    );
  };
  const navigateWithFilters = (next: {
    search?: string | null;
    sort?: string;
    page?: number;
  }) => {
    router.push(
      buildLibraryHref(
        { view, folderId, search: params.search, sort: params.sort },
        next
      )
    );
  };
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateWithFilters({ search: searchInput.trim() || null, page: 1 });
  };
  const openCreateFolderDialog = () => {
    setFolderForm({ mode: 'create', folder: null });
    setFolderName('');
    const currentFolder = folders.find((folder) => folder.folder_id === folderId);
    setFolderParentId(
      currentFolder && folderLevel(currentFolder, folders) < MAX_LIBRARY_FOLDER_LEVEL
        ? currentFolder.folder_id
        : ROOT_FOLDER_VALUE
    );
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
  const toggleVisibleEntries = (checked: boolean) => {
    setSelectedEntryIds(checked ? visibleEntryIds : []);
  };
  const clearSelection = () => setSelectedEntryIds([]);
  const closeEntryAction = () => setEntryAction(null);
  const entryActionIds = entryAction?.entry ? [entryAction.entry.entry_id] : selectedEntryIds;
  const entryActionCount = entryActionIds.length;
  const openPracticeStateAction = (entry: LibraryEntry | null) => {
    setPracticeState(entry?.practice_state === 'MASTERED' ? 'MASTERED' : 'TO_PRACTICE');
    setEntryAction({ type: 'practice', entry });
  };
  const openMoveAction = (entry: LibraryEntry | null) => {
    setMoveTargetFolderId(entry?.folder_id ?? ROOT_FOLDER_VALUE);
    setEntryAction({ type: 'move', entry });
  };
  const openDeleteAction = (entry: LibraryEntry | null) => {
    setEntryAction({ type: 'delete', entry });
  };
  const onEntryActionSuccess = () => {
    if (!entryAction?.entry) clearSelection();
    closeEntryAction();
  };
  const moveActionEntries = () => {
    if (!entryActionIds.length) return;
    moveEntries.mutate(
      {
        entry_ids: entryActionIds,
        target_folder_id: moveTargetFolderId === ROOT_FOLDER_VALUE ? null : moveTargetFolderId,
      },
      { onSuccess: onEntryActionSuccess }
    );
  };
  const setPracticeStateForActionEntries = () => {
    if (!entryActionIds.length) return;
    setEntriesPracticeState.mutate(
      { entry_ids: entryActionIds, practice_state: practiceState },
      { onSuccess: onEntryActionSuccess }
    );
  };
  const trashActionEntries = () => {
    if (!entryActionIds.length) return;
    trashEntries.mutate({ entry_ids: entryActionIds }, { onSuccess: onEntryActionSuccess });
  };
  const viewTitle = selectedFolder?.name ?? {
    all: t('allScores'),
    favorites: t('favorites'),
    recent_practice: t('recentPractice'),
    to_practice: t('toPractice'),
    mastered: t('mastered'),
    bookmarks: t('bookmarks'),
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

  React.useEffect(() => {
    setSelectedEntryIds([]);
    setBatchMode(false);
  }, [view, folderId, params.search, params.sort, page]);

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
          <LibrarySidebar
            currentView={view}
            currentFolderId={folderId}
            quickNodes={quickNodes}
            practiceNodes={practiceNodes}
            folders={sortedFolders}
            folderDepth={(folder) => folderDepth(folder, folders)}
            foldersError={foldersQuery.isError ? foldersQuery.error : null}
            createFolderPending={createFolder.isPending}
            onCreateFolder={openCreateFolderDialog}
            onRetryFolders={() => void foldersQuery.refetch()}
            onNavigateView={(nextView) => navigate({ view: nextView, folder: null })}
            onNavigateFolder={(nextFolderId) => navigate({ folder: nextFolderId })}
            onEditFolder={openEditFolderDialog}
            onDeleteFolder={setDeleteTarget}
            errorMessage={errorMessage}
            t={t}
          />
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
              <div className="flex flex-wrap gap-2">
                {entries.length ? (
                  <Button
                    variant={batchMode ? 'secondary' : 'outline'}
                    onClick={() => {
                      setBatchMode((current) => !current);
                      setSelectedEntryIds([]);
                    }}
                  >
                    {batchMode ? t('cancelBatchEdit') : t('batchEdit')}
                  </Button>
                ) : null}
                <Button onClick={() => router.push('/upload')}>{t('uploadScore')}</Button>
              </div>
            </div>
            {!batchMode ? (
            <LibraryFilterBar
              searchInput={searchInput}
              sort={normalizeLibrarySort(params.sort)}
              hasSearch={Boolean(params.search)}
              onSearchInputChange={setSearchInput}
              onSubmit={submitSearch}
              onSortChange={(value) => navigateWithFilters({ sort: value, page: 1 })}
              onClearSearch={() => {
                setSearchInput('');
                navigateWithFilters({ search: null, page: 1 });
              }}
              t={t}
            />
            ) : null}
            {mutationError ? (
              <Alert variant="destructive" className="mb-5">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>{t('operationFailed')}</AlertTitle>
                <AlertDescription>{errorMessage(mutationError)}</AlertDescription>
              </Alert>
            ) : null}
            {batchMode && entries.length ? (
              <LibraryBulkActions
                selectedCount={selectedEntryIds.length}
                allSelected={allVisibleSelected}
                pending={
                  moveEntries.isPending ||
                  trashEntries.isPending ||
                  setEntriesPracticeState.isPending
                }
                onToggleSelectAll={toggleVisibleEntries}
                onOpenPracticeStateDialog={() => openPracticeStateAction(null)}
                onOpenMoveDialog={() => openMoveAction(null)}
                onOpenDeleteDialog={() => openDeleteAction(null)}
                t={t}
              />
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
                  <LibraryEntryCard
                    key={entry.entry_id}
                    entry={entry}
                    batchMode={batchMode}
                    selected={selectedEntrySet.has(entry.entry_id)}
                    updatePending={setEntriesPracticeState.isPending}
                    movePending={moveEntries.isPending}
                    practiceStateLabel={practiceStateLabel}
                    onOpen={() =>
                      router.push(
                        `/score/${entry.score_id}?from=${
                          entry.source_type === 'BOOKMARK' ? 'shares' : 'my-scores'
                        }`
                      )
                    }
                    onToggleSelection={(checked) =>
                      toggleEntrySelection(entry.entry_id, checked)
                    }
                    onOpenPracticeStateDialog={() => openPracticeStateAction(entry)}
                    onOpenMoveDialog={() => openMoveAction(entry)}
                    onOpenDeleteDialog={() => openDeleteAction(entry)}
                    t={t}
                  />
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
            {pagination && pagination.total_pages > 1 ? (
              <LibraryPagination
                page={pagination.page}
                totalPages={pagination.total_pages}
                canGoPrevious={canGoPrevious}
                canGoNext={canGoNext}
                onPageChange={(nextPage) => navigateWithFilters({ page: nextPage })}
                t={t}
              />
            ) : null}
          </section>
        </div>
      </main>
      <LibraryFolderDialog
        open={folderForm !== null}
        mode={folderForm?.mode ?? 'create'}
        folderName={folderName}
        folderParentId={folderParentId}
        rootFolderValue={ROOT_FOLDER_VALUE}
        parentFolders={selectableParentFolders}
        createPending={createFolder.isPending}
        updatePending={updateFolder.isPending}
        onOpenChange={(open) => !open && closeFolderDialog()}
        onFolderNameChange={setFolderName}
        onFolderParentChange={setFolderParentId}
        onSubmit={submitFolderForm}
        onCancel={closeFolderDialog}
        t={t}
      />
      <LibraryDeleteFolderDialog
        folder={deleteTarget}
        deleteMode={deleteMode}
        deletePending={deleteFolder.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDeleteModeChange={setDeleteMode}
        onConfirm={confirmDeleteFolder}
        t={t}
      />
      <LibraryPracticeStateDialog
        open={entryAction?.type === 'practice'}
        count={entryActionCount}
        value={practiceState}
        pending={setEntriesPracticeState.isPending}
        onOpenChange={(open) => {
          if (!open) closeEntryAction();
        }}
        onValueChange={setPracticeState}
        onConfirm={setPracticeStateForActionEntries}
        t={t}
      />
      <LibraryMoveEntriesDialog
        open={entryAction?.type === 'move'}
        count={entryActionCount}
        folderId={moveTargetFolderId}
        rootFolderValue={ROOT_FOLDER_VALUE}
        folders={sortedFolders}
        pending={moveEntries.isPending}
        onOpenChange={(open) => {
          if (!open) closeEntryAction();
        }}
        onFolderChange={setMoveTargetFolderId}
        onConfirm={moveActionEntries}
        t={t}
      />
      <LibraryDeleteEntriesDialog
        open={entryAction?.type === 'delete'}
        count={entryActionCount}
        pending={trashEntries.isPending}
        onOpenChange={(open) => {
          if (!open) closeEntryAction();
        }}
        onConfirm={trashActionEntries}
        t={t}
      />
      <Footer />
    </div>
  );
}


