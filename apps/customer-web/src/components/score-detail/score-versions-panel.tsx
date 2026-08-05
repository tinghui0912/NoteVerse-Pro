'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, MoreHorizontal, Pencil, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { ResourceLoading } from '@/components/loading';
import { ResourceLoadError } from '@/components/states';
import { useToast } from '@/hooks/use-toast';
import {
  useRestoreRevision,
  useScoreRevisions,
  useUpdateRevisionNote,
} from '@/hooks/queries/use-score-queries';
import { formatApiDateTime } from '@/lib/date-time';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { cn } from '@/lib/utils';
import type { ScoreRevision } from '@/types/api';

interface ScoreVersionsPanelProps {
  scoreId: string;
  headRevisionId: string | null;
  canRestore: boolean;
}

const originLabels: Record<string, string> = {
  OMR: 'revisionOriginOMR',
  EDIT: 'revisionOriginEDIT',
  IMPORT: 'revisionOriginIMPORT',
};

export function ScoreVersionsPanel({
  scoreId,
  headRevisionId,
  canRestore,
}: ScoreVersionsPanelProps) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const { toast } = useToast();
  const [restoreNote, setRestoreNote] = useState('');
  const [restoreTargetId, setRestoreTargetId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [noteTargetId, setNoteTargetId] = useState<string | null>(null);
  const [expandedRevisionId, setExpandedRevisionId] = useState<string | null>(null);
  const revisions = useScoreRevisions(scoreId);
  const restoreRevision = useRestoreRevision();
  const updateNote = useUpdateRevisionNote();
  const error = revisions.error
    ? userFacingErrorMessage(errors, revisions.error, common('loadFailedDescription'))
    : null;

  const items = useMemo(
    () => revisions.data?.pages.flatMap((page) => page.data?.items ?? []) ?? [],
    [revisions.data]
  );
  const restoreTarget = items.find((revision) => revision.revision_id === restoreTargetId) ?? null;
  const noteTarget = items.find((revision) => revision.revision_id === noteTargetId) ?? null;

  const handleRestore = () => {
    if (!restoreTarget) return;
    const note = restoreNote.trim();
    restoreRevision.mutate(
      { scoreId, revisionId: restoreTarget.revision_id, note: note || null },
      {
        onSuccess: () => {
          setRestoreNote('');
          setRestoreTargetId(null);
          toast({
            title: t('restoreSuccess'),
            description: t('restoreSuccessDesc'),
          });
        },
        onError: (unknownError) => {
          const description = userFacingErrorMessage(
            errors,
            unknownError,
            t('restoreFailedDesc')
          );
          toast({
            title: t('restoreFailed'),
            description,
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleSaveNote = () => {
    if (!noteTarget) return;
    const note = noteDraft.trim();
    updateNote.mutate(
      { scoreId, revisionId: noteTarget.revision_id, note: note || null },
      {
        onSuccess: () => {
          setNoteDraft('');
          setNoteTargetId(null);
          toast({
            title: t('versionNoteSaved'),
          });
        },
        onError: (unknownError) => {
          const description = userFacingErrorMessage(
            errors,
            unknownError,
            t('versionNoteSaveFailedDesc')
          );
          toast({
            title: t('versionNoteSaveFailed'),
            description,
            variant: 'destructive',
          });
        },
      }
    );
  };

  if (revisions.isLoading) {
    return (
      <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
        <ResourceLoading label={t('loadingVersions')} minHeight="sm" />
      </div>
    );
  }

  if (error || !revisions.data) {
    return (
      <ResourceLoadError
        title={t('versionsLoadFailed')}
        description={error ?? t('versionsLoadFailedDesc')}
        actionLabel={common('tryAgain')}
        onAction={() => void revisions.refetch()}
        className="rounded-2xl"
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border bg-white p-6 text-sm text-muted-foreground shadow-sm">
        {t('noVersions')}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
      <div className="space-y-3">
        {items.map((revision) => (
          <VersionRow
            key={revision.revision_id}
            revision={revision}
            isCurrent={revision.revision_id === headRevisionId}
            canRestore={canRestore && revision.revision_id !== headRevisionId}
            isExpanded={expandedRevisionId === revision.revision_id}
            onToggleDetails={() =>
              setExpandedRevisionId(
                expandedRevisionId === revision.revision_id ? null : revision.revision_id
              )
            }
            onEditNote={() => {
              setNoteTargetId(revision.revision_id);
              setNoteDraft(revision.note?.note ?? '');
            }}
            onRestore={() => {
              setRestoreTargetId(revision.revision_id);
              setRestoreNote('');
            }}
          />
        ))}
      </div>

      {revisions.hasNextPage ? (
        <div className="mt-5 flex justify-center">
          <Button
            variant="outline"
            disabled={revisions.isFetchingNextPage}
            onClick={() => void revisions.fetchNextPage()}
          >
            {revisions.isFetchingNextPage ? t('loadingVersions') : t('loadMoreVersions')}
          </Button>
        </div>
      ) : null}

      <AlertDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreTargetId(null);
            setRestoreNote('');
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('restoreRevisionTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {restoreTarget
                ? t('restoreRevisionDesc', { version: restoreTarget.revision_number })
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            maxLength={500}
            placeholder={t('restoreNotePlaceholder')}
            value={restoreNote}
            onChange={(event) => setRestoreNote(event.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>{common('cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={restoreRevision.isPending} onClick={handleRestore}>
              {t('restoreRevision')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={Boolean(noteTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setNoteTargetId(null);
            setNoteDraft('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('versionNoteDialogTitle')}</DialogTitle>
            <DialogDescription>{t('versionNoteDialogDesc')}</DialogDescription>
          </DialogHeader>
          <Textarea
            maxLength={500}
            placeholder={t('versionNotePlaceholder')}
            value={noteDraft}
            onChange={(event) => setNoteDraft(event.target.value)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteTargetId(null)}>
              {common('cancel')}
            </Button>
            <Button disabled={updateNote.isPending} onClick={handleSaveNote}>
              {t('saveVersionNote')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VersionRow({
  revision,
  isCurrent,
  canRestore,
  isExpanded,
  onToggleDetails,
  onEditNote,
  onRestore,
}: {
  revision: ScoreRevision;
  isCurrent: boolean;
  canRestore: boolean;
  isExpanded: boolean;
  onToggleDetails: () => void;
  onEditNote: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations('score');
  const originKey = revision.restore
    ? 'revisionOriginRESTORE'
    : originLabels[revision.origin] ?? 'revisionOriginEDIT';
  const authorName = revision.created_by?.display_name
    || revision.created_by?.email
    || t('systemActor');
  const restoreSummary = revision.restore?.restored_from_revision_number
    ? t('restoredFromVersion', { version: revision.restore.restored_from_revision_number })
    : revision.restore
      ? t('restoredFromUnknownVersion')
      : null;

  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-foreground">
              {t('revisionNumber', { number: revision.revision_number })}
            </span>
            <Badge variant="outline">{t(originKey)}</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{formatApiDateTime(revision.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span>{authorName}</span>
            {restoreSummary ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{restoreSummary}</span>
              </>
            ) : null}
          </div>
          {revision.note?.note ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {t('versionNotePrefix', { note: revision.note.note })}
            </p>
          ) : revision.restore?.note ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {t('restoreReasonPrefix', { note: revision.restore.note })}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2">
          {isCurrent ? (
            <Badge className="bg-emerald-50 text-emerald-700">
              {t('currentVersion')}
            </Badge>
          ) : null}
          <Button variant="ghost" onClick={onToggleDetails}>
            {t('versionDetails')}
            <ChevronDown
              className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-180')}
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('versionActionsMenu')}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditNote}>
                <Pencil className="mr-2 h-4 w-4" />
                {revision.note?.note ? t('editVersionNote') : t('addVersionNote')}
              </DropdownMenuItem>
              {canRestore ? (
                <DropdownMenuItem onClick={onRestore}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  {t('restoreRevision')}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isExpanded ? (
        <div className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
          <VersionDetail label={t('revisionIdLabel')} value={revision.revision_id} />
          {revision.restore ? (
            <>
              <VersionDetail
                label={t('restoreSourceLabel')}
                value={
                  revision.restore.restored_from_revision_number
                    ? t('revisionNumber', {
                      number: revision.restore.restored_from_revision_number,
                    })
                    : '-'
                }
              />
              <VersionDetail
                label={t('restoreTimeLabel')}
                value={formatApiDateTime(revision.restore.created_at)}
              />
            </>
          ) : null}
          {revision.note ? (
            <>
              <VersionDetail
                label={t('versionNoteUpdatedAtLabel')}
                value={formatApiDateTime(revision.note.updated_at)}
              />
              <VersionDetail
                label={t('versionNoteAuthorLabel')}
                value={revision.note.author?.display_name || revision.note.author?.email || '-'}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VersionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="break-all font-medium">{value}</div>
    </div>
  );
}
