'use client';
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { EditorSession } from '@/lib/editor/session';
const SessionContext = createContext<EditorSession | null>(null);
export function EditorSessionProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new EditorSession());
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
export function useEditorSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('EditorSessionProvider is required.');
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return {
    ...state,
    loadMusicXml: session.loadMusicXml,
    applyCommand: session.applyCommand,
    replaceFromExternalMusicXml: session.replaceFromExternalMusicXml,
    clearDocument: session.clearDocument,
    undo: session.undo,
    redo: session.redo,
    prepareVoice: session.prepareVoice,
    discardInputVoice: session.discardInputVoice,
  };
}
