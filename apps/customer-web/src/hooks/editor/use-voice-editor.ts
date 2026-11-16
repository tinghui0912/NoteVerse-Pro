'use client';
import { useTranslations } from 'next-intl';
import { useEditorSession } from '@/contexts/editor-session-context';
import { deleteVoice, type VoiceId } from '@/lib/editor-domain';
export function useVoiceEditor() {
  const { applyCommand } = useEditorSession();
  const t = useTranslations('editor.actions');
  return {
    handleDeleteVoiceTrack: (voiceId: VoiceId) =>
      applyCommand(
        (document) => deleteVoice(document, voiceId),
        t('deleteVoice', { voice: String(voiceId) }),
      ),
  };
}
