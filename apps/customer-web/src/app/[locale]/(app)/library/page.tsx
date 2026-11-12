'use client';

import React, { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Music, Star, Target } from 'lucide-react';
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
import { PaginationControls } from '@/components/ui/pagination-controls';
import { LibrarySidebar } from '@/components/library/library-sidebar';
import { SectionLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { SectionErrorState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/page';
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
  buildLibraryHref,
  normalizeLibraryView,
  sortedLibraryFolders,
  normalizeLibrarySort,
  normalizePage,
  type UserSettableLibraryPracticeState,
} from '@/lib/library/state';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import type {
  FolderDeleteMode,
  LibraryEntryRead,
  LibraryFolderRead,
  LibraryPracticeState,
  LibraryView,
} from '@/generated/api';

const ROOT_FOLDER_VALUE = '__root__';

type FolderFormState =
  | { mode: 'create'; folder: null }
  | { mode: 'edit'; folder: LibraryFolderRead };

type EntryActionState =
  | { type: 'practice'; entry: LibraryEntryRead | null }
  | { type: 'move'; entry: LibraryEntryRead | null }
  | { type: 'delete'; entry: LibraryEntryRead | null }
  | null;

type LibrarySelectionState = {
  scopeKey: string;
  batchMode: boolean;
  selectedEntryIds: string[];
};

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
  const errors = useTranslations('errors');
  const router = useRouter();
  const view = normalizeLibraryView(params.view);
  const folderId = params.folder;
  const page = normalizePage(params.page);
  const pageSize = 20;
  const selectionScopeKey = [
    view,
    folderId ?? '',
    params.search ?? '',
    normalizeLibrarySort(params.sort),
    page,
  ].join('\u0000');
  const [selectionState, setSelectionState] = useState<LibrarySelectionState>(
    () => ({
      scopeKey: selectionScopeKey,
      batchMode: false,
      selectedEntryIds: [],
    }),
  );
  const activeSelectionState =
    selectionState.scopeKey === selectionScopeKey
      ? selectionState
      : { scopeKey: selectionScopeKey, batchMode: false, selectedEntryIds: [] };
  const batchMode = activeSelectionState.batchMode;
  const selectedEntryIds = activeSelectionState.selectedEntryIds;
  const [moveTargetFolderId, setMoveTargetFolderId] =
    useState<string>(ROOT_FOLDER_VALUE);
  const [folderForm, setFolderForm] = useState<FolderFormState | null>(null);
  const [folderName, setFolderName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LibraryFolderRead | null>(
    null,
  );
  const [deleteMode, setDeleteMode] = useState<FolderDeleteMode>(
    'MOVE_CONTENTS_TO_ROOT',
  );
  const [searchInput, setSearchInput] = useState(params.search ?? '');
  const [entryAction, setEntryAction] = useState<EntryActionState>(null);
  const [practiceState, setPracticeState] =
    useState<UserSettableLibraryPracticeState>('TO_PRACTICE');
  const createFolder = useCreateLibraryFolder();
  const updateFolder = useUpdateLibraryFolder();
  const deleteFolder = useDeleteLibraryFolder();
  const moveEntries = useMoveLibraryEntries();
  const setEntriesPracticeState = useSetLibraryEntriesPracticeState();
  const trashEntries = useTrashLibraryEntries();
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
    [foldersQuery.data?.data?.folders],
  );
  const entries = useMemo(
    () => entriesQuery.data?.data ?? [],
    [entriesQuery.data?.data],
  );
  const pagination = entriesQuery.data?.pagination;
  const canGoPrevious = pagination ? pagination.page > 1 : false;
  const canGoNext = pagination
    ? pagination.page < pagination.total_pages
    : false;
  const selectedFolder = folders.find(
    (folder) => folder.folder_id === folderId,
  );
  const selectedEntrySet = useMemo(
    () => new Set(selectedEntryIds),
    [selectedEntryIds],
  );
  const visibleEntryIds = useMemo(
    () => entries.map((entry) => entry.entry_id),
    [entries],
  );
  const allVisibleSelected =
    visibleEntryIds.length > 0 &&
    visibleEntryIds.every((entryId) => selectedEntrySet.has(entryId));
  const mutationError =
    createFolder.error ??
    updateFolder.error ??
    deleteFolder.error ??
    moveEntries.error ??
    trashEntries.error ??
    setEntriesPracticeState.error;
  const folderOverview = foldersQuery.data?.data;
  const quickNodes = [
    {
      view: 'all' as const,
      label: t('allScores'),
      count: folderOverview?.all_count ?? 0,
      icon: Music,
    },
    {
      view: 'favorites' as const,
      label: t('favorites'),
      count: folderOverview?.favorite_count ?? 0,
      icon: Star,
    },
  ];

  const practiceNodes = [
    {
      view: 'recent_practice' as const,
      label: t('recentPractice'),
      count: folderOverview?.recent_practice_count ?? 0,
      icon: Clock3,
    },
    {
      view: 'to_practice' as const,
      label: t('toPractice'),
      count: folderOverview?.to_practice_count ?? 0,
      icon: Target,
    },
    {
      view: 'mastered' as const,
      label: t('mastered'),
      count: folderOverview?.mastered_count ?? 0,
      icon: CheckCircle2,
    },
  ];

  const sortedFolders = useMemo(() => sortedLibraryFolders(folders), [folders]);

  const navigate = (next: {
    view?: LibraryView;
    folder?: string | null;
    page?: number;
  }) => {
    router.push(
      buildLibraryHref(
        { view, folderId, search: params.search, sort: params.sort },
        next,
      ),
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
        next,
      ),
    );
  };
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigateWithFilters({ search: searchInput.trim() || null, page: 1 });
  };
  const openCreateFolderDialog = () => {
    setFolderForm({ mode: 'create', folder: null });
    setFolderName('');
  };
  const openEditFolderDialog = (folder: LibraryFolderRead) => {
    setFolderForm({ mode: 'edit', folder });
    setFolderName(folder.name);
  };
  const closeFolderDialog = () => {
    setFolderForm(null);
    setFolderName('');
  };
  const submitFolderForm = () => {
    const name = folderName.trim();
    if (!folderForm || !name) return;
    if (folderForm.mode === 'create') {
      createFolder.mutate({ name }, { onSuccess: closeFolderDialog });
      return;
    }
    updateFolder.mutate(
      {
        folderId: folderForm.folder.folder_id,
        name,
      },
      { onSuccess: closeFolderDialog },
    );
  };
  const confirmDeleteFolder = () => {
    if (!deleteTarget) return;
    deleteFolder.mutate(
      { folderId: deleteTarget.folder_id, mode: deleteMode },
      {
        onSuccess: () => {
          if (folderId === deleteTarget.folder_id)
            navigate({ view: 'all', folder: null });
          setDeleteTarget(null);
        },
      },
    );
  };
  const updateSelectionState = (
    updater: (current: LibrarySelectionState) => LibrarySelectionState,
  ) => {
    setSelectionState((current) =>
      updater(
        current.scopeKey === selectionScopeKey
          ? current
          : {
              scopeKey: selectionScopeKey,
              batchMode: false,
              selectedEntryIds: [],
            },
      ),
    );
  };
  const setSelectedEntryIds = (
    next: string[] | ((current: string[]) => string[]),
  ) => {
    updateSelectionState((current) => ({
      ...current,
      selectedEntryIds:
        typeof next === 'function' ? next(current.selectedEntryIds) : next,
    }));
  };
  const setBatchMode = (next: boolean | ((current: boolean) => boolean)) => {
    updateSelectionState((current) => ({
      ...current,
      batchMode: typeof next === 'function' ? next(current.batchMode) : next,
    }));
  };
  const toggleEntrySelection = (entryId: string, checked: boolean) => {
    setSelectedEntryIds((current) =>
      checked ? [...current, entryId] : current.filter((id) => id !== entryId),
    );
  };
  const toggleVisibleEntries = (checked: boolean) => {
    setSelectedEntryIds(checked ? visibleEntryIds : []);
  };
  const clearSelection = () => setSelectedEntryIds([]);
  const closeEntryAction = () => setEntryAction(null);
  const entryActionIds = entryAction?.entry
    ? [entryAction.entry.entry_id]
    : selectedEntryIds;
  const entryActionCount = entryActionIds.length;
  const openPracticeStateAction = (entry: LibraryEntryRead | null) => {
    setPracticeState(
      entry?.practice_state === 'MASTERED' ? 'MASTERED' : 'TO_PRACTICE',
    );
    setEntryAction({ type: 'practice', entry });
  };
  const openMoveAction = (entry: LibraryEntryRead | null) => {
    setMoveTargetFolderId(entry?.folder_id ?? ROOT_FOLDER_VALUE);
    setEntryAction({ type: 'move', entry });
  };
  const openDeleteAction = (entry: LibraryEntryRead | null) => {
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
        target_folder_id:
          moveTargetFolderId === ROOT_FOLDER_VALUE ? null : moveTargetFolderId,
      },
      { onSuccess: onEntryActionSuccess },
    );
  };
  const setPracticeStateForActionEntries = () => {
    if (!entryActionIds.length) return;
    setEntriesPracticeState.mutate(
      { entry_ids: entryActionIds, practice_state: practiceState },
      { onSuccess: onEntryActionSuccess },
    );
  };
  const trashActionEntries = () => {
    if (!entryActionIds.length) return;
    trashEntries.mutate(
      { entry_ids: entryActionIds },
      { onSuccess: onEntryActionSuccess },
    );
  };
  const viewTitle =
    selectedFolder?.name ??
    {
      all: t('allScores'),
      favorites: t('favorites'),
      recent_practice: t('recentPractice'),
      to_practice: t('toPractice'),
      mastered: t('mastered'),
      trash: t('trash'),
    }[view];
  const practiceStateLabel = (practiceState: LibraryPracticeState) =>
    ({
      TO_PRACTICE: t('practiceStateToPractice'),
      IN_PROGRESS: t('practiceStateInProgress'),
      MASTERED: t('practiceStateMastered'),
    })[practiceState];
  const formatUserFacingError = (
    error: unknown,
    fallback = t('loadFailedDescription'),
  ) => userFacingErrorMessage(errors, error, fallback);
  const retryEntries = () => {
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button onClick={() => router.push('/upload')}>
            {t('uploadScore')}
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <LibrarySidebar
          currentView={view}
          currentFolderId={folderId}
          quickNodes={quickNodes}
          practiceNodes={practiceNodes}
          folders={sortedFolders}
          foldersLoading={foldersQuery.isLoading}
          foldersError={foldersQuery.isError ? foldersQuery.error : null}
          createFolderPending={createFolder.isPending}
          onCreateFolder={openCreateFolderDialog}
          onRetryFolders={() => void foldersQuery.refetch()}
          onNavigateView={(nextView) =>
            navigate({ view: nextView, folder: null })
          }
          onNavigateFolder={(nextFolderId) =>
            navigate({ folder: nextFolderId })
          }
          onEditFolder={openEditFolderDialog}
          onDeleteFolder={setDeleteTarget}
          errorMessage={(error) => formatUserFacingError(error)}
          t={t}
        />
        <section>
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-bold">{viewTitle}</h2>
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
            </div>
          </div>
          {!batchMode ? (
            <LibraryFilterBar
              searchInput={searchInput}
              sort={normalizeLibrarySort(params.sort)}
              hasSearch={Boolean(params.search)}
              onSearchInputChange={setSearchInput}
              onSubmit={submitSearch}
              onSortChange={(value) =>
                navigateWithFilters({ sort: value, page: 1 })
              }
              onClearSearch={() => {
                setSearchInput('');
                navigateWithFilters({ search: null, page: 1 });
              }}
              t={t}
            />
          ) : null}
          {mutationError ? (
            <SectionErrorState
              title={t('operationFailed')}
              description={formatUserFacingError(
                mutationError,
                t('operationFailedDescription'),
              )}
              className="mb-5"
            />
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
            <SectionLoading label={t('loadingEntries')} className="py-20" />
          ) : entriesQuery.isError ? (
            <SectionErrorState
              title={t('entriesLoadFailed')}
              description={formatUserFacingError(entriesQuery.error)}
              retryLabel={t('retry')}
              onRetry={retryEntries}
            />
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
                    router.push(`/score/${entry.score_id}?from=${'my-scores'}`)
                  }
                  onToggleSelection={(checked) =>
                    toggleEntrySelection(entry.entry_id, checked)
                  }
                  onOpenPracticeStateDialog={() =>
                    openPracticeStateAction(entry)
                  }
                  onOpenMoveDialog={() => openMoveAction(entry)}
                  onOpenDeleteDialog={() => openDeleteAction(entry)}
                  t={t}
                />
              ))}
            </div>
          ) : (
            <Card className="rounded-2xl">
              <CardContent>
                <EmptyState
                  icon={Music}
                  title={emptyMessage}
                  className="py-20"
                  action={
                    !folderId && view === 'all' && !params.search ? (
                      <Button onClick={() => router.push('/upload')}>
                        {t('uploadScore')}
                      </Button>
                    ) : null
                  }
                />
              </CardContent>
            </Card>
          )}
          {pagination && pagination.total_pages > 1 ? (
            <PaginationControls
              page={pagination.page}
              totalPages={pagination.total_pages}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPageChange={(nextPage) =>
                navigateWithFilters({ page: nextPage })
              }
              t={t}
            />
          ) : null}
        </section>
      </div>
      <LibraryFolderDialog
        open={folderForm !== null}
        mode={folderForm?.mode ?? 'create'}
        folderName={folderName}
        createPending={createFolder.isPending}
        updatePending={updateFolder.isPending}
        onOpenChange={(open) => !open && closeFolderDialog()}
        onFolderNameChange={setFolderName}
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
    </div>
  );
}
