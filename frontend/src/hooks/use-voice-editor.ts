'use client';

/**
 * 声部编辑 Hook - 管理声部的增删清空
 */

import { useCallback } from 'react';
import { useScoreData } from '../contexts/score-data-context';
import { useHistory } from '../contexts/history-context';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import {
    parseXml,
    serializeXml,
} from '@/lib/musicxml/core';
import { useTranslations } from 'next-intl';
import { recalculateBackups } from '@/lib/musicxml/backup';

export function useVoiceEditor() {
    const t = useTranslations('editor.actions');
    const {
        scoreData,
        currentXml,
        currentXmlRef,
        setScoreData,
        setCurrentXml
    } = useScoreData();

    const history = useHistory();

    /**
     * 从 XML 中删除指定声部的元素
     */
    const removeVoiceElementsFromXml = useCallback((
        measureIndex: number,
        staveIndex: number,
        xmlVoice: number
    ): string | null => {
        if (!currentXml) return null;

        const staffNumber = staveIndex + 1;
        const measureNumber = measureIndex + 1;

        try {
            const xmlDoc = parseXml(currentXml);
            const measureEl = xmlDoc.querySelector(`measure[number="${measureNumber}"]`);

            if (!measureEl) return serializeXml(xmlDoc);

            // 删除该 voice 的所有 note 元素
            const notes = Array.from(measureEl.querySelectorAll('note'));
            notes.forEach(note => {
                const staffEl = note.querySelector('staff');
                const voiceEl = note.querySelector('voice');
                const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
                const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
                if (staff === staffNumber && voice === xmlVoice) {
                    note.parentNode?.removeChild(note);
                }
            });

            // 删除该 voice 的所有 forward 元素
            const forwards = Array.from(measureEl.querySelectorAll('forward'));
            forwards.forEach(forward => {
                const voiceEl = forward.querySelector('voice');
                const staffEl = forward.querySelector('staff');
                const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
                const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
                if (staff === staffNumber && voice === xmlVoice) {
                    forward.parentNode?.removeChild(forward);
                }
            });

            recalculateBackups(measureEl);
            return serializeXml(xmlDoc);
        } catch (error) {
            console.error('Failed to remove voice elements:', error);
            return null;
        }
    }, [currentXml]);

    /**
     * 添加声部
     */
    const handleAddVoice = useCallback((measureIndex: number, staveIndex: number) => {
        setScoreData(prevData => {
            if (!prevData) return null;

            const newMeasures = JSON.parse(JSON.stringify(prevData.measures));
            const stave = newMeasures[measureIndex].staves[staveIndex];

            const existingNumbers = new Set<number>(stave.voices.map((v: { name: string }) => {
                const match = v.name.match(/\d+/);
                return match ? parseInt(match[0], 10) : 0;
            }));

            const baseNumber = staveIndex === 1 ? 5 : 1;
            const maxNumber = staveIndex === 1 ? 8 : 4;

            let newVoiceNumber = baseNumber;
            while (existingNumbers.has(newVoiceNumber) && newVoiceNumber <= maxNumber) {
                newVoiceNumber++;
            }

            if (newVoiceNumber > maxNumber) {
                const maxExisting = existingNumbers.size > 0 ? Math.max(...Array.from(existingNumbers)) : baseNumber - 1;
                newVoiceNumber = maxExisting + 1;
            }

            const newVoice = { name: `voiceLabel ${newVoiceNumber}`, notes: [] };

            const insertIndex = stave.voices.findIndex((v: { name: string }) => {
                const match = v.name.match(/\d+/);
                const num = match ? parseInt(match[0], 10) : 0;
                return num > newVoiceNumber;
            });

            if (insertIndex === -1) {
                stave.voices.push(newVoice);
            } else {
                stave.voices.splice(insertIndex, 0, newVoice);
            }

            return {
                ...prevData,
                measures: newMeasures,
                connections: prevData.connections
            };
        });
    }, [setScoreData]);

    /**
     * 清空声部
     */
    const handleClearVoice = useCallback((measureIndex: number, staveIndex: number, xmlVoice: number) => {
        if (!currentXml || !scoreData) return;

        const newXml = removeVoiceElementsFromXml(measureIndex, staveIndex, xmlVoice);
        if (!newXml) return;

        history.push(newXml, t('clearVoice', { voice: xmlVoice }));
        currentXmlRef.current = newXml;
        setCurrentXml(newXml);

        // 重新解析 XML 以正确更新 noteCount 等统计数据
        const parser = new MusicXMLParser(newXml);
        const newData = parser.parse();

        // 保留被清空的声部（空声部）
        // 解析器不会为没有元素的声部创建数据，需要手动保留
        const oldStave = scoreData.measures[measureIndex]?.staves[staveIndex];
        const newStave = newData.measures[measureIndex]?.staves[staveIndex];
        if (oldStave && newStave) {
            const oldVoice = oldStave.voices.find((v: { name: string }) => v.name.includes(`${xmlVoice}`));
            if (oldVoice) {
                // 检查新数据中是否还有这个声部
                const voiceStillExists = newStave.voices.some((v: { name: string }) => v.name.includes(`${xmlVoice}`));
                if (!voiceStillExists) {
                    // 声部不存在了，需要添加一个空声部
                    newStave.voices.push({ name: oldVoice.name, notes: [] });
                    // 按声部编号排序
                    newStave.voices.sort((a: { name: string }, b: { name: string }) => {
                        const numA = parseInt(a.name.match(/\d+/)?.[0] || '0', 10);
                        const numB = parseInt(b.name.match(/\d+/)?.[0] || '0', 10);
                        return numA - numB;
                    });
                }
            }
        }

        setScoreData(newData);
    }, [currentXml, currentXmlRef, scoreData, setCurrentXml, setScoreData, history, removeVoiceElementsFromXml, t]);

    /**
     * 删除声部
     */
    const handleDeleteVoice = useCallback((measureIndex: number, staveIndex: number, xmlVoice: number, _voiceArrayIndex: number) => {
        if (!currentXml || !scoreData) return;

        const newXml = removeVoiceElementsFromXml(measureIndex, staveIndex, xmlVoice);
        if (!newXml) return;

        history.push(newXml, t('deleteVoice', { voice: xmlVoice }));
        currentXmlRef.current = newXml;
        setCurrentXml(newXml);

        // 重新解析 XML 以正确更新 noteCount 等统计数据
        const parser = new MusicXMLParser(newXml);
        const newData = parser.parse();
        setScoreData(newData);
    }, [currentXml, currentXmlRef, scoreData, setCurrentXml, setScoreData, history, removeVoiceElementsFromXml, t]);

    return {
        handleAddVoice,
        handleClearVoice,
        handleDeleteVoice,
    };
}
