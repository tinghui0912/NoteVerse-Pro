'use client';

import React, { useEffect, useRef } from 'react';
import { ScoreDataProvider, useScoreData } from './score-data-context';
import { EditorStateProvider, useEditorState } from './editor-state-context';
import { HoverStateProvider } from './hover-state-context';
import { HistoryProvider, useHistory } from './editor-history-context';

// Re-export types and hooks for convenience
export { useScoreData } from './score-data-context';
export { useEditorState, type EditorMode } from './editor-state-context';
export { useHoverState } from './hover-state-context';
export { useHistory, useHistoryControl } from './editor-history-context';

// Re-export domain operation hooks
export { useEntityEditor } from '../hooks/editor/use-entity-editor';
export { useVoiceEditor } from '../hooks/editor/use-voice-editor';
export { useHistoryEditor } from '../hooks/editor/use-history-editor';
export { useXmlUpdater } from '../hooks/editor/use-xml-updater';
export { useMetadataEditor } from '../hooks/editor/use-metadata-editor';

/**
 * 组合 Hook - 获取所有编辑器上下文（用于复杂组件）
 */
export function useEditor() {
    const scoreData = useScoreData();
    const editorState = useEditorState();
    const history = useHistory();

    return {
        ...scoreData,
        ...editorState,
        ...history,
    };
}

/**
 * 内部组件：连接 History 和 ScoreData
 */
function HistoryScoreDataConnector({ children }: { children: React.ReactNode }) {
    const { currentXml } = useScoreData();
    const { initialize, isInitialized } = useHistory();
    const historyInitializedRef = useRef(false);

    // 当 currentXml 首次设置时，初始化历史记录
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
 * 主 Editor Provider - 组合所有 Context
 */
export function EditorProvider({ children }: EditorProviderProps) {
    return (
        <ScoreDataProvider>
            <HistoryProvider>
                <EditorStateProvider>
                    <HoverStateProvider>
                        <HistoryScoreDataConnector>
                            {children}
                        </HistoryScoreDataConnector>
                    </HoverStateProvider>
                </EditorStateProvider>
            </HistoryProvider>
        </ScoreDataProvider>
    );
}
