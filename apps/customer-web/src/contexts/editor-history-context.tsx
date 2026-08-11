'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect } from 'react';

/**
 * Undo/redo history entry.
 */
interface HistoryEntry {
    xml: string;
    action: string;
    timestamp: number;
}

/**
 * History context for XML undo/redo state.
 */
interface HistoryContextType {
    // History state.
    canUndo: boolean;
    canRedo: boolean;

    // History operations.
    push: (xml: string, action: string) => void;
    undo: () => string | null;
    redo: () => string | null;

    // Current XML accessor.
    getCurrentXml: () => string | null;

    // Initialization state.
    initialize: (xml: string) => void;
    isInitialized: boolean;
}

const HistoryContext = createContext<HistoryContextType | undefined>(undefined);

/**
 * Returns the full editor history controller.
 */
export function useHistory() {
    const context = useContext(HistoryContext);
    if (!context) {
        throw new Error('useHistory must be used within a HistoryProvider');
    }
    return context;
}

/**
 * Returns the commonly used undo/redo controls.
 */
export function useHistoryControl() {
    const { canUndo, canRedo, undo, redo } = useHistory();
    return { canUndo, canRedo, undo, redo };
}

interface HistoryProviderProps {
    children: React.ReactNode;
    maxHistorySize?: number;
    onXmlChange?: (xml: string) => void;
}

/**
 * Provides XML edit history state.
 */
export function HistoryProvider({
    children,
    maxHistorySize = 50,
    onXmlChange
}: HistoryProviderProps) {
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isInitialized, setIsInitialized] = useState(false);

    // Use a ref to avoid stale onXmlChange closures in undo/redo callbacks.
    const onXmlChangeRef = useRef(onXmlChange);
    useEffect(() => {
        onXmlChangeRef.current = onXmlChange;
    }, [onXmlChange]);

    const canUndo = currentIndex > 0;
    const canRedo = currentIndex < history.length - 1;

    /**
     * Initializes the history stack with the first XML snapshot.
     */
    const initialize = useCallback((xml: string) => {
        if (isInitialized) return;

        setHistory([{
            xml,
            action: 'initial',
            timestamp: Date.now()
        }]);
        setCurrentIndex(0);
        setIsInitialized(true);
    }, [isInitialized]);

    /**
     * Pushes a new XML snapshot onto the history stack.
     */
    const push = useCallback((xml: string, action: string) => {
        // Skip duplicate snapshots.
        const currentXml = history[currentIndex]?.xml;
        if (currentXml === xml) {
            return;
        }

        setHistory(prev => {
            // Drop redo entries after the current index.
            const newHistory = prev.slice(0, currentIndex + 1);

            // Add the new entry.
            newHistory.push({
                xml,
                action,
                timestamp: Date.now()
            });

            // Enforce the configured history limit.
            if (newHistory.length > maxHistorySize) {
                newHistory.shift();
            }

            return newHistory;
        });

        setCurrentIndex(prev => Math.min(prev + 1, maxHistorySize - 1));
    }, [currentIndex, maxHistorySize, history]);

    /**
     * Moves one history entry backward.
     */
    const undo = useCallback((): string | null => {
        if (!canUndo) return null;

        const newIndex = currentIndex - 1;
        setCurrentIndex(newIndex);

        const xml = history[newIndex]?.xml || null;
        if (xml && onXmlChangeRef.current) {
            onXmlChangeRef.current(xml);
        }

        return xml;
    }, [canUndo, currentIndex, history]);

    /**
     * Moves one history entry forward.
     */
    const redo = useCallback((): string | null => {
        if (!canRedo) return null;

        const newIndex = currentIndex + 1;
        setCurrentIndex(newIndex);

        const xml = history[newIndex]?.xml || null;
        if (xml && onXmlChangeRef.current) {
            onXmlChangeRef.current(xml);
        }

        return xml;
    }, [canRedo, currentIndex, history]);

    /**
     * Returns the current XML snapshot.
     */
    const getCurrentXml = useCallback((): string | null => {
        return history[currentIndex]?.xml || null;
    }, [history, currentIndex]);

    const value = useMemo<HistoryContextType>(() => ({
        canUndo,
        canRedo,
        push,
        undo,
        redo,
        getCurrentXml,
        initialize,
        isInitialized,
    }), [canUndo, canRedo, push, undo, redo, getCurrentXml, initialize, isInitialized]);

    return (
        <HistoryContext.Provider value={value}>
            {children}
        </HistoryContext.Provider>
    );
}
