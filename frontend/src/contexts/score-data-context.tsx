'use client';

import React, { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';
import type { ScoreData } from '@/types/score-types';
import { MusicXMLParser } from '@/lib/musicxml/parser';

/**
 * ScoreData Context - 管理乐谱数据的只读访问和更新
 */
interface ScoreDataContextType {
    // 只读数据
    scoreData: ScoreData | null;
    currentXml: string | null;
    rawXml: string | null;

    // Ref 用于获取最新值（避免闭包问题）
    currentXmlRef: React.MutableRefObject<string | null>;

    // 数据更新函数
    setScoreData: React.Dispatch<React.SetStateAction<ScoreData | null>>;
    setCurrentXml: (xml: string) => void;
    setRawXml: React.Dispatch<React.SetStateAction<string | null>>;

    // 辅助函数
    getExpectedVoices: (data: ScoreData | null) => Map<number, Map<number, number[]>> | undefined;
    reparseXml: (xml: string) => ScoreData | null;
}

const ScoreDataContext = createContext<ScoreDataContextType | undefined>(undefined);

/**
 * ScoreData Hook - 获取乐谱数据
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
 * ScoreData Provider - 提供乐谱数据上下文
 */
export function ScoreDataProvider({ children }: ScoreDataProviderProps) {
    const [scoreData, setScoreData] = useState<ScoreData | null>(null);
    const [currentXml, setCurrentXmlState] = useState<string | null>(null);
    const [rawXml, setRawXml] = useState<string | null>(null);

    // Ref 用于在回调函数中获取最新值
    const currentXmlRef = useRef<string | null>(null);

    // 更新 XML 时同时更新 ref
    const setCurrentXml = useCallback((xml: string) => {
        currentXmlRef.current = xml;
        setCurrentXmlState(xml);
    }, []);

    /**
     * 从 scoreData 中提取期望保留的声部结构
     * 用于在重新解析 XML 时保留空声部
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
     * 重新解析 XML 并更新 scoreData
     */
    const reparseXml = useCallback((xml: string) => {
        try {
            const expectedVoices = getExpectedVoices(scoreData);
            const parser = new MusicXMLParser(xml, { expectedVoices });
            const newScoreData = parser.parse();
            setScoreData(newScoreData);
            return newScoreData;
        } catch (error) {
            console.error('Failed to reparse XML:', error);
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
