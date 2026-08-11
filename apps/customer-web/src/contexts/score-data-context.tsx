'use client';

import React, { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';
import type { ScoreData } from '@/types/score-types';
import { MusicXMLParser } from '@/lib/musicxml/parser';

/**
 * Score data context for parsed score state and XML updates.
 */
interface ScoreDataContextType {
    // Read-only data.
    scoreData: ScoreData | null;
    currentXml: string | null;
    rawXml: string | null;

    // Ref for reading the latest XML in callbacks without stale closures.
    currentXmlRef: React.MutableRefObject<string | null>;

    // Data update functions.
    setScoreData: React.Dispatch<React.SetStateAction<ScoreData | null>>;
    setCurrentXml: (xml: string) => void;
    setRawXml: React.Dispatch<React.SetStateAction<string | null>>;

    // Helper functions.
    getExpectedVoices: (data: ScoreData | null) => Map<number, Map<number, number[]>> | undefined;
    reparseXml: (xml: string) => ScoreData | null;
}

const ScoreDataContext = createContext<ScoreDataContextType | undefined>(undefined);

/**
 * Returns parsed score data and XML state.
 */
export function useScoreData() {
    const context = useContext(ScoreDataContext);
    if (!context) {
        throw new Error('useScoreData must be used within a ScoreDataProvider');
    }
    return context;
}

interface ScoreDataProviderProps {
    children: React.ReactNode;
}

/**
 * Provides parsed score data and current XML state.
 */
export function ScoreDataProvider({ children }: ScoreDataProviderProps) {
    const [scoreData, setScoreData] = useState<ScoreData | null>(null);
    const [currentXml, setCurrentXmlState] = useState<string | null>(null);
    const [rawXml, setRawXml] = useState<string | null>(null);

    // Ref for reading the latest XML inside callbacks.
    const currentXmlRef = useRef<string | null>(null);

    // Update the XML state and latest-value ref together.
    const setCurrentXml = useCallback((xml: string) => {
        currentXmlRef.current = xml;
        setCurrentXmlState(xml);
    }, []);

    /**
     * Extracts the voice structure that should be preserved on reparse.
     *
     * This keeps empty voices visible after XML is regenerated and parsed again.
     */
    const getExpectedVoices = useCallback((data: ScoreData | null): Map<number, Map<number, number[]>> | undefined => {
        if (!data) return undefined;

        const expectedVoices = new Map<number, Map<number, number[]>>();

        data.measures.forEach((measure, measureIndex) => {
            const staveVoices = new Map<number, number[]>();

            measure.staves.forEach((stave, staveIndex) => {
                const voiceNumbers = stave.voices.map(voice => {
                    const match = voice.name.match(/\d+/);
                    return match ? parseInt(match[0], 10) : 1;
                });
                staveVoices.set(staveIndex, voiceNumbers);
            });

            expectedVoices.set(measureIndex, staveVoices);
        });

        return expectedVoices;
    }, []);

    /**
     * Reparses XML and updates scoreData.
     */
    const reparseXml = useCallback((xml: string) => {
        try {
            const expectedVoices = getExpectedVoices(scoreData);
            const parser = new MusicXMLParser(xml, { expectedVoices });
            const newScoreData = parser.parse();
            setScoreData(newScoreData);
            return newScoreData;
        } catch {
            return null;
        }
    }, [scoreData, getExpectedVoices]);

    const value = useMemo<ScoreDataContextType>(() => ({
        scoreData,
        currentXml,
        rawXml,
        currentXmlRef,
        setScoreData,
        setCurrentXml,
        setRawXml,
        getExpectedVoices,
        reparseXml,
    }), [scoreData, currentXml, rawXml, setCurrentXml, getExpectedVoices, reparseXml]);

    return (
        <ScoreDataContext.Provider value={value}>
            {children}
        </ScoreDataContext.Provider>
    );
}
