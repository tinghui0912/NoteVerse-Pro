'use client';
import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useEditorSession } from '@/contexts/editor-session-context';
import {
  initialMeasure,
  updateInitialKeySignature,
  updateMeter,
  updateScoreMetadata,
  type DocumentMetadata,
  type TempoNotation,
} from '@/lib/editor-domain';
export function useMetadataEditor() {
  const { applyCommand } = useEditorSession();
  const t = useTranslations('editor.actions');
  const metadata = useCallback(
    (patch: Partial<DocumentMetadata>, label: string) =>
      applyCommand((document) => updateScoreMetadata(document, patch), label),
    [applyCommand],
  );
  return {
    updateNotationTitle: (value: string) =>
      metadata({ notationTitle: value.trim() || null }, t('updateTitle')),
    updateScoreSubtitle: (value: string) =>
      metadata({ subtitle: value.trim() || null }, t('updateSubtitle')),
    updateScoreComposer: (value: string) =>
      metadata({ composer: value.trim() || null }, t('updateComposer')),
    updateScoreLyricist: (value: string) =>
      metadata({ lyricist: value.trim() || null }, t('updateLyricist')),
    updateScoreCopyright: (value: string) =>
      metadata({ copyright: value.trim() || null }, t('updateCopyright')),
    updateKeySignature: (value: string) =>
      applyCommand(
        (document) =>
          updateInitialKeySignature(document, initialMeasure(document).id, {
            fifths: Number(value),
          }),
        t('updateKeySignature'),
      ),
    updateTimeSignature: (value: string) => {
      const [beats, beatType] = value.split('/').map(Number);
      return applyCommand(
        (document) => updateMeter(document, initialMeasure(document).id, { beats, beatType }),
        t('updateTimeSignature'),
      );
    },
    updateTempo: (
      value: string,
      options?: { beatUnit?: string; dots?: number; showMark?: boolean },
    ) =>
      metadata(
        {
          tempoNotation: {
            perMinute: Number(value),
            beatUnit: (options?.beatUnit ?? 'quarter') as TempoNotation['beatUnit'],
            dots: options?.dots ?? 0,
            visible: options?.showMark ?? false,
          },
        },
        t('updateTempo'),
      ),
  };
}
