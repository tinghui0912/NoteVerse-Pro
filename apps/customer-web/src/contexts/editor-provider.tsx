'use client';

import React, { useEffect, useRef } from 'react';
import { ScoreDataProvider, useScoreData } from './score-data-context';
import { EditorStateProvider } from './editor-state-context';
import { HistoryProvider, useHistory } from './editor-history-context';

// Re-export types and hooks for convenience
export { useScoreData } from './score-data-context';
export { useEditorState, type EditorMode } from './editor-state-context';
export { useHistory } from './editor-history-context';

// Re-export domain operation hooks
export { useEntityEditor } from '../hooks/editor/use-entity-editor';
export { useVoiceEditor } from '../hooks/editor/use-voice-editor';
export { useHistoryEditor } from '../hooks/editor/use-history-editor';
export { useMetadataEditor } from '../hooks/editor/use-metadata-editor';
export { useEditorDomainEdit } from '../hooks/editor/use-editor-domain-edit';
export { useEditorDomainRenderAnchors } from '../hooks/editor/use-editor-domain-render-anchors';
export { useEditingDomainInspectorViewModel } from '../hooks/editor/use-editing-domain-event';

/**
 * Internal connector that initializes History from ScoreData.
 */
function HistoryScoreDataConnector({ children }: { children: React.ReactNode }) {
    const { currentXml } = useScoreData();
    const { initialize, isInitialized } = useHistory();
    const historyInitializedRef = useRef(false);

    // Initialize history once when currentXml is first available.
    useEffect(() => {
        if (currentXml && !historyInitializedRef.current && !isInitialized) {
            initialize(currentXml);
            historyInitializedRef.current = true;
        }
    }, [currentXml, initialize, isInitialized]);

    return <>{children}</>;
}

interface EditorProviderProps {
    children: React.ReactNode;
}

/**
 * Root editor provider that composes all editor contexts.
 */
export function EditorProvider({ children }: EditorProviderProps) {
    return (
        <ScoreDataProvider>
            <HistoryProvider>
                <EditorStateProvider>
                    <HistoryScoreDataConnector>
                        {children}
                    </HistoryScoreDataConnector>
                </EditorStateProvider>
            </HistoryProvider>
        </ScoreDataProvider>
    );
}
