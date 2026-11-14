'use client';

import React, { useMemo, useState } from 'react';
import { Music, Star, User, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LibraryBulkActions } from '@/components/library/library-bulk-actions';
import { LibraryDeleteFolderDialog } from '@/components/library/library-delete-folder-dialog';
import { ScoreDeleteDialog } from '@/components/score/score-delete-dialog';
import {
  useDeleteScores,
  useLeaveScore,
} from '@/hooks/queries/use-score-queries';
import { ScoreLeaveDialog } from '@/components/score/score-leave-dialog';
import { LibraryScoreCard } from '@/components/library/library-score-card';
import { LibraryMoveScoresDialog } from '@/components/library/library-move-scores-dialog';
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
  useLibraryScores,
  useLibraryFolders,
  useMoveLibraryScores,
  useFavoriteLibraryScores,
  useUpdateLibraryFolder,
} from '@/hooks/queries/use-library-queries';
import {
  buildLibraryHref,
  normalizeLibraryView,
  sortedLibraryFolders,
  normalizeLibrarySort,
  normalizePage,
} from '@/lib/library/state';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import type {
  LibraryScoreRead,
  LibraryFolderRead,
  LibraryView,
} from '@/generated/api';

const ROOT_FOLDER_VALUE = '__root__';

type FolderFormState =
  | { mode: 'create'; folder: null }
  | { mode: 'edit'; folder: LibraryFolderRead };

type ScoreActionState = { type: 'move'; score: LibraryScoreRead | null } | null;

type LibrarySelectionState = {
  scopeKey: string;
  batchMode: boolean;
  selectedScoreIds: string[];
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
  const ownerLifecycleScope = view === 'created_by_me' && !folderId;
  const deleteScores = useDeleteScores();
  const memberLifecycleScope = view === 'shared_with_me' && !folderId;
  const leaveScore = useLeaveScore();
  const [leaveTarget, setLeaveTarget] = useState<LibraryScoreRead | null>(null);
  const [deletionTargets, setDeletionTargets] = useState<LibraryScoreRead[]>(
    [],
  );
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
      selectedScoreIds: [],
    }),
  );
  const activeSelectionState =
    selectionState.scopeKey === selectionScopeKey
      ? selectionState
      : { scopeKey: selectionScopeKey, batchMode: false, selectedScoreIds: [] };
  const batchMode = activeSelectionState.batchMode;
  const selectedScoreIds = activeSelectionState.selectedScoreIds;
  const [moveTargetFolderId, setMoveTargetFolderId] =
    useState<string>(ROOT_FOLDER_VALUE);
  const [folderForm, setFolderForm] = useState<FolderFormState | null>(null);
  const [folderName, setFolderName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<LibraryFolderRead | null>(
    null,
  );
  const [searchInput, setSearchInput] = useState(params.search ?? '');
  const [scoreAction, setScoreAction] = useState<ScoreActionState>(null);
  const createFolder = useCreateLibraryFolder();
  const updateFolder = useUpdateLibraryFolder();
  const deleteFolder = useDeleteLibraryFolder();
  const moveScores = useMoveLibraryScores();
  const favoriteScores = useFavoriteLibraryScores();
  const foldersQuery = useLibraryFolders();
  const scoresQuery = useLibraryScores({
    view,
    folderId,
    search: params.search,
    sort: normalizeLibrarySort(params.sort),
    page,
    pageSize,
  });
  const folders = useMemo(
    () => foldersQuery.data?.folders ?? [],
    [foldersQuery.data?.folders],
  );
  const scores = useMemo(
    () => scoresQuery.data?.items ?? [],
    [scoresQuery.data?.items],
  );
  const pagination = scoresQuery.data;
  const canGoPrevious = pagination ? pagination.page > 1 : false;
  const canGoNext = pagination
    ? pagination.page < pagination.total_pages
    : false;
  const selectedFolder = folders.find(
    (folder) => folder.folder_id === folderId,
  );
  const selectedScoreSet = useMemo(
    () => new Set(selectedScoreIds),
    [selectedScoreIds],
  );
  const visibleScoreIds = useMemo(
    () => scores.map((score) => score.score_id),
    [scores],
  );
  const allVisibleSelected =
    visibleScoreIds.length > 0 &&
    visibleScoreIds.every((scoreId) => selectedScoreSet.has(scoreId));
  const mutationError =
    createFolder.error ??
    updateFolder.error ??
    deleteFolder.error ??
    moveScores.error ??
    favoriteScores.error;
  const folderOverview = foldersQuery.data;
  const quickNodes = [
    {
      view: 'all' as const,
      label: t('allScores'),
      count: folderOverview?.all_count ?? 0,
      icon: Music,
    },
    {
      view: 'created_by_me' as const,
      label: t('createdByMe'),
      count: folderOverview?.created_by_me_count ?? 0,
      icon: User,
    },
    {
      view: 'shared_with_me' as const,
      label: t('sharedWithMe'),
      count: folderOverview?.shared_with_me_count ?? 0,
      icon: Users,
    },
    {
      view: 'favorites' as const,
      label: t('favorites'),
      count: folderOverview?.favorite_count ?? 0,
      icon: Star,
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
    deleteFolder.mutate(deleteTarget.folder_id, {
      onSuccess: () => {
        if (folderId === deleteTarget.folder_id)
          navigate({ view: 'all', folder: null });
        setDeleteTarget(null);
      },
    });
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
              selectedScoreIds: [],
            },
      ),
    );
  };
  const setSelectedScoreIds = (
    next: string[] | ((current: string[]) => string[]),
  ) => {
    updateSelectionState((current) => ({
      ...current,
      selectedScoreIds:
        typeof next === 'function' ? next(current.selectedScoreIds) : next,
    }));
  };
  const setBatchMode = (next: boolean | ((current: boolean) => boolean)) => {
    updateSelectionState((current) => ({
      ...current,
      batchMode: typeof next === 'function' ? next(current.batchMode) : next,
    }));
  };
  const toggleScoreSelection = (scoreId: string, checked: boolean) => {
    setSelectedScoreIds((current) =>
      checked ? [...current, scoreId] : current.filter((id) => id !== scoreId),
    );
  };
  const toggleVisibleScores = (checked: boolean) => {
    setSelectedScoreIds(checked ? visibleScoreIds : []);
  };
  const clearSelection = () => setSelectedScoreIds([]);
  const closeScoreAction = () => setScoreAction(null);
  const scoreActionIds = scoreAction?.score
    ? [scoreAction.score.score_id]
    : selectedScoreIds;
  const scoreActionCount = scoreActionIds.length;
  const openMoveAction = (score: LibraryScoreRead | null) => {
    setMoveTargetFolderId(score?.folder_id ?? ROOT_FOLDER_VALUE);
    setScoreAction({ type: 'move', score });
  };
  const onScoreActionSuccess = () => {
    if (!scoreAction?.score) clearSelection();
    closeScoreAction();
  };
  const moveActionScores = () => {
    if (!scoreActionIds.length) return;
    moveScores.mutate(
      {
        score_ids: scoreActionIds,
        target_folder_id:
          moveTargetFolderId === ROOT_FOLDER_VALUE ? null : moveTargetFolderId,
      },
      { onSuccess: onScoreActionSuccess },
    );
  };
  const setSelectedFavorite = (isFavorite: boolean) => {
    if (!selectedScoreIds.length) return;
    favoriteScores.mutate(
      { score_ids: selectedScoreIds, is_favorite: isFavorite },
      { onSuccess: clearSelection },
    );
  };
  const viewTitle =
    selectedFolder?.name ??
    {
      all: t('allScores'),
      favorites: t('favorites'),
      created_by_me: t('createdByMe'),
      shared_with_me: t('sharedWithMe'),
    }[view];
  const formatUserFacingError = (
    error: unknown,
    fallback = t('loadFailedDescription'),
  ) => userFacingErrorMessage(errors, error, fallback);
  const retryScores = () => {
    void scoresQuery.refetch();
  };
  const emptyMessages: Partial<Record<LibraryView, string>> = {
    favorites: t('emptyFavorites'),
    created_by_me: t('emptyCreatedByMe'),
    shared_with_me: t('emptySharedWithMe'),
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
              {scores.length ? (
                <Button
                  variant={batchMode ? 'secondary' : 'outline'}
                  onClick={() => {
                    setBatchMode((current) => !current);
                    setSelectedScoreIds([]);
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
          {batchMode && scores.length ? (
            <LibraryBulkActions
              selectedCount={selectedScoreIds.length}
              allSelected={allVisibleSelected}
              pending={moveScores.isPending || favoriteScores.isPending}
              onToggleSelectAll={toggleVisibleScores}
              onDeleteScores={
                ownerLifecycleScope
                  ? () => {
                      deleteScores.reset();
                      setDeletionTargets(
                        scores.filter((score) =>
                          selectedScoreSet.has(score.score_id),
                        ),
                      );
                    }
                  : undefined
              }
              onFavorite={() => setSelectedFavorite(true)}
              onOpenMoveDialog={() => openMoveAction(null)}
              onUnfavorite={() => setSelectedFavorite(false)}
              t={t}
            />
          ) : null}
          {scoresQuery.isLoading ? (
            <SectionLoading label={t('loadingScores')} className="py-20" />
          ) : scoresQuery.isError ? (
            <SectionErrorState
              title={t('scoresLoadFailed')}
              description={formatUserFacingError(scoresQuery.error)}
              retryLabel={t('retry')}
              onRetry={retryScores}
            />
          ) : scores.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {scores.map((score) => (
                <LibraryScoreCard
                  key={score.score_id}
                  score={score}
                  batchMode={batchMode}
                  selected={selectedScoreSet.has(score.score_id)}
                  favoritePending={favoriteScores.isPending}
                  movePending={moveScores.isPending}
                  onOpen={() => router.push(`/score/${score.score_id}`)}
                  onToggleSelection={(checked) =>
                    toggleScoreSelection(score.score_id, checked)
                  }
                  onToggleFavorite={() =>
                    favoriteScores.mutate({
                      score_ids: [score.score_id],
                      is_favorite: !score.is_favorite,
                    })
                  }
                  onDeleteScore={
                    ownerLifecycleScope && score.access_origin === 'OWNER'
                      ? () => {
                          deleteScores.reset();
                          setDeletionTargets([score]);
                        }
                      : undefined
                  }
                  onLeaveScore={
                    memberLifecycleScope && score.access_origin === 'MEMBERSHIP'
                      ? () => {
                          leaveScore.reset();
                          setLeaveTarget(score);
                        }
                      : undefined
                  }
                  onOpenMoveDialog={() => openMoveAction(score)}
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
      <ScoreDeleteDialog
        open={deletionTargets.length > 0}
        titles={deletionTargets.map((score) => score.title)}
        pending={deleteScores.isPending}
        error={deleteScores.error}
        onOpenChange={(open) => {
          if (!open) setDeletionTargets([]);
        }}
        onConfirm={() => {
          if (!ownerLifecycleScope) return;
          deleteScores.mutate(
            deletionTargets.map((score) => score.score_id),
            {
              onSuccess: () => {
                setDeletionTargets([]);
                clearSelection();
              },
            },
          );
        }}
      />
      <ScoreLeaveDialog
        open={leaveTarget !== null}
        title={leaveTarget?.title ?? ''}
        pending={leaveScore.isPending}
        error={leaveScore.error}
        onOpenChange={(open) => {
          if (!open) setLeaveTarget(null);
        }}
        onConfirm={() => {
          if (!memberLifecycleScope || !leaveTarget) return;
          leaveScore.mutate(leaveTarget.score_id, {
            onSuccess: () => setLeaveTarget(null),
          });
        }}
      />
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
        deletePending={deleteFolder.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={confirmDeleteFolder}
        t={t}
      />
      <LibraryMoveScoresDialog
        open={scoreAction?.type === 'move'}
        count={scoreActionCount}
        folderId={moveTargetFolderId}
        rootFolderValue={ROOT_FOLDER_VALUE}
        folders={sortedFolders}
        pending={moveScores.isPending}
        onOpenChange={(open) => {
          if (!open) closeScoreAction();
        }}
        onFolderChange={setMoveTargetFolderId}
        onConfirm={moveActionScores}
        t={t}
      />
    </div>
  );
}
