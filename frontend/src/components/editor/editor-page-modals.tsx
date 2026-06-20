'use client';

import { AlertTriangle, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AddEntityModal } from '@/components/editor/add-entity-modal';
import { ChordEditorModal } from '@/components/editor/chord-editor-modal';
import { DraftRecoveryDialog } from '@/components/editor/draft-recovery-dialog';
import { NoteEditorModal } from '@/components/editor/note-editor-modal';
import { OriginalImageViewer } from '@/components/media/original-image-viewer';
import { ListenModal } from '@/components/score/listen-modal';
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
import { useEditorState, useEntityEditor, useScoreData } from '@/contexts/editor-provider';
import type { DraftEntry } from '@/lib/draft-storage';
import type { ValidationResult } from '@/lib/musicxml/validator';
import type { Blank, Chord, Note, Rest } from '@/types/score-types';

interface EditorPageModalsProps {
  draft: DraftEntry | null;
  draftOpen: boolean;
  listenOpen: boolean;
  originalImages: { src: string; alt: string }[];
  previewXml: string | null;
  validationOpen: boolean;
  validationResult: ValidationResult | null;
  onDiscardDraft: () => Promise<void>;
  onDraftOpenChange: (open: boolean) => void;
  onListenOpenChange: (open: boolean) => void;
  onRecoverDraft: () => Promise<void>;
  onSaveIgnoringWarnings: () => void;
  onValidationOpenChange: (open: boolean) => void;
}

export function EditorPageModals(props: EditorPageModalsProps) {
  const t = useTranslations('editor');
  const common = useTranslations('common');
  const auth = useTranslations('auth');
  const { scoreData } = useScoreData();
  const {
    editingEntity,
    isAddEntityModalOpen,
    currentAddLocation,
    isImageViewerOpen,
    setIsAddEntityModalOpen,
    setIsImageViewerOpen,
  } = useEditorState();
  const { handleSelectEntityType, handleCloseModal, updateEntity } = useEntityEditor();
  const noteModalOpen = editingEntity !== null && ['note', 'rest', 'blank'].includes(editingEntity.type);
  const chordModalOpen = editingEntity?.type === 'chord';

  const voiceName = (() => {
    if (!currentAddLocation || !scoreData) return '';
    const stave = scoreData.measures[currentAddLocation.measureIndex]?.staves[currentAddLocation.staveIndex];
    const voice = stave?.voices.find((item) => item.name.includes(`${currentAddLocation.xmlVoice}`));
    if (!voice) return '';
    const [key, number] = voice.name.split(' ');
    return `${t(key as never)} ${number}`;
  })();

  return (
    <>
      <OriginalImageViewer images={props.originalImages} isOpen={isImageViewerOpen} onClose={() => setIsImageViewerOpen(false)} />
      <ListenModal isOpen={props.listenOpen} onOpenChange={props.onListenOpenChange} xmlString={props.previewXml} />
      <AddEntityModal isOpen={isAddEntityModalOpen} onClose={() => setIsAddEntityModalOpen(false)} onSelect={handleSelectEntityType} voiceName={voiceName} />
      {editingEntity && noteModalOpen && (
        <NoteEditorModal
          isOpen
          onClose={handleCloseModal}
          onSave={(result) => updateEntity({ ...editingEntity, ...result } as Note | Rest | Blank)}
          note={editingEntity as Note | Rest | Blank}
        />
      )}
      {editingEntity && chordModalOpen && (
        <ChordEditorModal
          isOpen
          onClose={handleCloseModal}
          onSave={(result) => updateEntity({ ...editingEntity, ...result } as Chord)}
          chord={editingEntity as Chord}
        />
      )}

      <AlertDialog open={props.validationOpen} onOpenChange={props.onValidationOpenChange}>
        <AlertDialogContent className="flex max-h-[85vh] max-w-lg flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {props.validationResult?.success ? <><AlertTriangle className="h-5 w-5 text-yellow-500" /><span>{auth('validation.warning')}</span></> : <><XCircle className="h-5 w-5 text-destructive" /><span>{auth('validation.failed')}</span></>}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-2 text-left custom-scrollbar">
                {props.validationResult?.issues?.length ? (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3">
                    <p className="mb-2 text-sm font-medium text-destructive">{auth('validation.foundIssues', { count: props.validationResult.issues.length })}</p>
                    <ul className="space-y-1 text-xs">{props.validationResult.issues.map((issue, index) => <li key={`${index}-${issue}`} className="border-l-2 border-destructive/30 pl-3 text-destructive/80">{issue}</li>)}</ul>
                  </div>
                ) : null}
                {props.validationResult?.warnings?.length ? (
                  <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3">
                    <p className="mb-2 text-sm font-medium text-yellow-600">{auth('validation.foundWarnings', { count: props.validationResult.warnings.length })}</p>
                    <ul className="max-h-40 space-y-1 overflow-y-auto text-xs custom-scrollbar">{props.validationResult.warnings.map((warning, index) => <li key={`${index}-${warning}`} className="border-l-2 border-yellow-500/30 pl-3 text-yellow-600/80">{warning}</li>)}</ul>
                  </div>
                ) : null}
                <p className="text-sm text-muted-foreground">{props.validationResult?.success ? auth('validation.warningDescription') : auth('validation.errorDescription')}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 shrink-0">
            <AlertDialogCancel className="border-muted-foreground/20">{common('goBack')}</AlertDialogCancel>
            {props.validationResult?.success && props.validationResult.warnings.length > 0 ? <AlertDialogAction onClick={props.onSaveIgnoringWarnings}>{auth('validation.ignoreAndSave')}</AlertDialogAction> : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DraftRecoveryDialog
        open={props.draftOpen}
        onOpenChange={props.onDraftOpenChange}
        draft={props.draft}
        onRecover={props.onRecoverDraft}
        onDiscard={props.onDiscardDraft}
      />
    </>
  );
}
