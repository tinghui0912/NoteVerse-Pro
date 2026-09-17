'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { DomainSelectionCompanion } from '@/lib/editor/domain-selection-companion';
import type { DomainAnchor } from '@/lib/editor-domain';
import {
    createRhythmicGridResolution,
    type InsertionAnchor,
    type InputDuration,
    type RhythmicGridResolution,
} from '@/lib/editor-domain';
import {
    createDefaultAddModeInputDuration,
    createDefaultAddModeInputState,
    type AddModeInputState,
} from '@/hooks/editor/entity-editor/add-mode-command';

/**
 * Editor tool mode.
 */
export type EditorMode =
    | 'select'
    | 'add'
    | 'delete'
    | 'addTie'
    | 'deleteTie'
    | 'addSlur'
    | 'deleteSlur';

export type EditingSelectionState = {
    /** Canonical selection identity for rendering and future domain commands. */
    domainAnchor: DomainAnchor | null;
    domainCompanion: DomainSelectionCompanion | null;
};

export type EditingSelectionInput = Omit<EditingSelectionState, 'domainAnchor'> & {
    domainAnchor?: DomainAnchor | null;
};

export type InsertionPreviewState = {
    anchor: InsertionAnchor;
    inputDuration: InputDuration;
};

/**
 * Editor UI state context.
 */
interface EditorStateContextType {
    // Active editor tool.
    editorMode: EditorMode;
    selectTool: (mode: EditorMode) => void;
    addModeInputDuration: InputDuration;
    setAddModeInputDuration: React.Dispatch<React.SetStateAction<InputDuration>>;
    addModeInput: AddModeInputState;
    setAddModeInput: React.Dispatch<React.SetStateAction<AddModeInputState>>;
    addModeGridResolution: RhythmicGridResolution;
    setAddModeGridResolution: React.Dispatch<React.SetStateAction<RhythmicGridResolution>>;
    insertionPreview: InsertionPreviewState | null;
    setInsertionPreview: React.Dispatch<React.SetStateAction<InsertionPreviewState | null>>;

    // Current entity editing state.
    editingSelection: EditingSelectionState | null;
    openEditingSelection: (selection: EditingSelectionInput) => void;
    clearEditingSelection: () => void;

    // Original image viewer state.
    isImageViewerOpen: boolean;
    setIsImageViewerOpen: React.Dispatch<React.SetStateAction<boolean>>;

    // Callback for clearing tool-specific selection state.
    onToolChange: ((mode: EditorMode) => void) | null;
    setOnToolChange: (callback: ((mode: EditorMode) => void) | null) => void;

    // Workbench UI state.
    activeTrackId: string | null;
    setActiveTrackId: React.Dispatch<React.SetStateAction<string | null>>;
    visibleTrackIds: string[];
    setVisibleTrackIds: React.Dispatch<React.SetStateAction<string[]>>;
    inspectorOpen: boolean;
    setInspectorOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

const EditorStateContext = createContext<EditorStateContextType | undefined>(undefined);

/**
 * Returns editor UI state.
 */
export function useEditorState() {
    const context = useContext(EditorStateContext);
    if (!context) {
        throw new Error('useEditorState must be used within an EditorStateProvider');
    }
    return context;
}

interface EditorStateProviderProps {
    children: React.ReactNode;
}

/**
 * Provides editor UI state.
 */
export function EditorStateProvider({ children }: EditorStateProviderProps) {
    const [editorMode, setEditorMode] = useState<EditorMode>('select');
    const [addModeInputDuration, setAddModeInputDuration] = useState(() => createDefaultAddModeInputDuration());
    const [addModeInput, setAddModeInput] = useState(() => createDefaultAddModeInputState());
    const [addModeGridResolution, setAddModeGridResolution] = useState(() => createRhythmicGridResolution({
        numerator: 1,
        denominator: 1,
    }));
    const [insertionPreview, setInsertionPreview] = useState<InsertionPreviewState | null>(null);
    const [editingSelection, setEditingSelection] = useState<EditingSelectionState | null>(null);
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [onToolChange, setOnToolChangeState] = useState<((mode: EditorMode) => void) | null>(null);
    const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
    const [visibleTrackIds, setVisibleTrackIds] = useState<string[]>([]);
    const [inspectorOpen, setInspectorOpen] = useState(false);

    const selectTool = useCallback((mode: EditorMode) => {
        // Clicking the active tool toggles back to select mode.
        const newMode = editorMode === mode ? 'select' : mode;
        setEditorMode(newMode);
        // Notify connection tools so they can clear selection state.
        if (onToolChange) {
            onToolChange(newMode);
        }
    }, [editorMode, onToolChange]);



    const setOnToolChange = useCallback((callback: ((mode: EditorMode) => void) | null) => {
        setOnToolChangeState(() => callback);
    }, []);

    const openEditingSelection = useCallback((selection: EditingSelectionInput) => {
        setEditingSelection({
            ...selection,
            domainAnchor: selection.domainAnchor ?? selection.domainCompanion?.domainAnchor ?? null,
        });
    }, []);

    const clearEditingSelection = useCallback(() => {
        setEditingSelection(null);
    }, []);

    const value = useMemo<EditorStateContextType>(() => ({
        editorMode,
        selectTool,
        addModeInputDuration,
        setAddModeInputDuration,
        addModeInput,
        setAddModeInput,
        addModeGridResolution,
        setAddModeGridResolution,
        insertionPreview,
        setInsertionPreview,
        editingSelection,
        openEditingSelection,
        clearEditingSelection,
        isImageViewerOpen,
        setIsImageViewerOpen,
        onToolChange,
        setOnToolChange,
        activeTrackId,
        setActiveTrackId,
        visibleTrackIds,
        setVisibleTrackIds,
        inspectorOpen,
        setInspectorOpen,
    }), [
        editorMode, selectTool, addModeInputDuration, addModeInput, addModeGridResolution, insertionPreview, editingSelection,
        openEditingSelection, clearEditingSelection,
        isImageViewerOpen, onToolChange, setOnToolChange,
        activeTrackId, visibleTrackIds, inspectorOpen
    ]);

    return (
        <EditorStateContext.Provider value={value}>
            {children}
        </EditorStateContext.Provider>
    );
}
