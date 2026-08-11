'use client';

/**
 * Voice editing hook for adding, clearing, and deleting voices.
 */

import { useCallback } from 'react';
import { useScoreData } from '@/contexts/score-data-context';
import { useHistory } from '@/contexts/editor-history-context';
import { MusicXMLParser } from '@/lib/musicxml/parser';
import {
    parseXml,
    serializeXml,
} from '@/lib/musicxml/core';
import { useTranslations } from 'next-intl';
import { recalculateBackups } from '@/lib/musicxml/backup';
import { reportUnexpectedClientError } from '@/lib/observability';

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
     * Remove all MusicXML elements for a specific voice.
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

            // Remove all note elements for this voice.
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

            // Remove all forward elements for this voice.
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
        } catch {
            return null;
        }
    }, [currentXml]);

    /**
     * Add a voice to a staff.
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
     * Clear all events from a voice while keeping the voice visible.
     */
    const handleClearVoice = useCallback((measureIndex: number, staveIndex: number, xmlVoice: number) => {
        if (!currentXml || !scoreData) return;

        const newXml = removeVoiceElementsFromXml(measureIndex, staveIndex, xmlVoice);
        if (!newXml) return;

        history.push(newXml, t('clearVoice', { voice: xmlVoice }));
        currentXmlRef.current = newXml;
        setCurrentXml(newXml);

        // Reparse XML so note counts and derived score statistics stay current.
        const parser = new MusicXMLParser(newXml);
        const newData = parser.parse();

        // Preserve the cleared voice as an empty editor voice.
        // The parser only creates voices with elements, so empty voices must be restored manually.
        const oldStave = scoreData.measures[measureIndex]?.staves[staveIndex];
        const newStave = newData.measures[measureIndex]?.staves[staveIndex];
        if (oldStave && newStave) {
            const oldVoice = oldStave.voices.find((v: { name: string }) => v.name.includes(`${xmlVoice}`));
            if (oldVoice) {
                // Check whether the reparsed score still contains this voice.
                const voiceStillExists = newStave.voices.some((v: { name: string }) => v.name.includes(`${xmlVoice}`));
                if (!voiceStillExists) {
                    // Restore the voice as empty when parsing removed it.
                    newStave.voices.push({ name: oldVoice.name, notes: [] });
                    // Keep voices sorted by voice number.
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
     * Delete a voice from the score data and MusicXML.
     */
    const handleDeleteVoice = useCallback((measureIndex: number, staveIndex: number, xmlVoice: number, _voiceArrayIndex: number) => {
        if (!currentXml || !scoreData) return;

        const newXml = removeVoiceElementsFromXml(measureIndex, staveIndex, xmlVoice);
        if (!newXml) return;

        history.push(newXml, t('deleteVoice', { voice: xmlVoice }));
        currentXmlRef.current = newXml;
        setCurrentXml(newXml);

        // Reparse XML so note counts and derived score statistics stay current.
        const parser = new MusicXMLParser(newXml);
        const newData = parser.parse();
        setScoreData(newData);
    }, [currentXml, currentXmlRef, scoreData, setCurrentXml, setScoreData, history, removeVoiceElementsFromXml, t]);

    const handleDeleteTrack = useCallback((_staveIndex: number, xmlVoice: number) => {
        if (!currentXml || !scoreData) return;

        try {
            const xmlDoc = parseXml(currentXml);

            Array.from(xmlDoc.querySelectorAll('measure')).forEach((measureEl) => {
                Array.from(measureEl.querySelectorAll('note, forward')).forEach((element) => {
                    const voiceEl = element.querySelector('voice');
                    const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

                    if (voice === xmlVoice) {
                        element.remove();
                    }
                });

                recalculateBackups(measureEl);
            });

            const newXml = serializeXml(xmlDoc);
            history.push(newXml, t('deleteVoice', { voice: xmlVoice }));
            currentXmlRef.current = newXml;
            setCurrentXml(newXml);

            const parser = new MusicXMLParser(newXml);
            setScoreData(parser.parse());
        } catch (error) {
            reportUnexpectedClientError(error, {
                area: 'editor',
                action: 'delete_voice_track',
            });
        }
    }, [currentXml, currentXmlRef, scoreData, setCurrentXml, setScoreData, history, t]);

    return {
        handleAddVoice,
        handleClearVoice,
        handleDeleteVoice,
        handleDeleteTrack,
    };
}
