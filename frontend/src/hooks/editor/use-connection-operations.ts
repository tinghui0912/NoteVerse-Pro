'use client';

import { useTranslations } from 'next-intl';

import { useState, useCallback } from 'react';
import type { ScoreData, ScoreEntity, EntityLocation, EntityMeta } from '@/types/score-types';
import {
    removeTieElementsFromXML,
    removeSlurElementsFromXML,
    addTieElementsToXML,
    addSlurElementsToXML,
} from '@/lib/musicxml/connections';
import { findEntityMetaById } from '@/lib/editor/score-lookup';

// 操作结果类型
type OperationResult = {
    success: boolean;
    message: string;
    count?: number;
};

// 选中音符类型
type SelectedNote = {
    entity: ScoreEntity;
    location: EntityLocation;
};

// Hook 参数类型
type UseConnectionOperationsParams = {
    scoreData: ScoreData | null;
    currentXml: string | null;
    updateMusicXML: (updater: (doc: XMLDocument) => void, actionName?: string) => void;
};

/**
 * 连接操作 Hook - 管理 tie/slur 的添加和删除
 */
export function useConnectionOperations({
    scoreData,
    currentXml,
    updateMusicXML
}: UseConnectionOperationsParams) {
    const t = useTranslations('editor');
  const tCommon = useTranslations('common');

    // 选中状态
    const [selectedNotesForTie, setSelectedNotesForTie] = useState<SelectedNote[]>([]);
    const [selectedNotesForSlur, setSelectedNotesForSlur] = useState<SelectedNote[]>([]);

    // 清除选中状态的函数（供 selectTool 调用）
    const clearTieSelection = useCallback(() => setSelectedNotesForTie([]), []);
    const clearSlurSelection = useCallback(() => setSelectedNotesForSlur([]), []);

    // 删除连音线（tie）
    const handleDeleteTie = (entity: ScoreEntity): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const entityId = entity.meta.id;
        const entityConns = scoreData.connections.noteConnections.get(entityId);

        // 检查实体是否有连音线
        if (!entityConns || entityConns.ties.length === 0) {
            return { success: false, message: t('noteHasNoTie') };
        }

        const allNoteIds = new Set<string>([entityId]);
        const entityMetas: EntityMeta[] = [];

        if (entity.meta) {
            entityMetas.push(entity.meta);
        }

        entityConns.ties.forEach(tie => {
            if (!allNoteIds.has(tie.partnerId)) {
                allNoteIds.add(tie.partnerId);
                const meta = findEntityMetaById(scoreData, tie.partnerId);
                if (meta) entityMetas.push(meta);
            }
        });

        const count = allNoteIds.size;

        updateMusicXML((xmlDoc) => {
            removeTieElementsFromXML(xmlDoc, entityMetas);
        }, t('deleteTie'));

        return { success: true, message: t('tieDeleted', { count }), count };
    };

    // 删除连奏线（slur）
    const handleDeleteSlur = (entity: ScoreEntity): OperationResult => {
        if (!scoreData?.connections?.noteConnections || !entity.meta?.id || !currentXml) {
            return { success: false, message: t('noConnectionData') };
        }

        const entityId = entity.meta.id;
        const entityConns = scoreData.connections.noteConnections.get(entityId);

        if (!entityConns || entityConns.slurs.length === 0) {
            return { success: false, message: t('noteHasNoSlur') };
        }

        const allNoteIds = new Set<string>();
        const entityMetas: EntityMeta[] = [];

        entityConns.slurs.forEach(slur => {
            slur.partnerIds.forEach(id => {
                if (!allNoteIds.has(id)) {
                    allNoteIds.add(id);
                    const meta = findEntityMetaById(scoreData, id);
                    if (meta) entityMetas.push(meta);
                }
            });
        });

        const count = allNoteIds.size;

        updateMusicXML((xmlDoc) => {
            removeSlurElementsFromXML(xmlDoc, entityMetas);
        }, t('deleteSlur'));

        return { success: true, message: t('slurDeleted', { count }), count };
    };

    // 添加连音线
    const handleAddTieSelection = (location: EntityLocation, entity: ScoreEntity): OperationResult => {
        if (!currentXml || !entity.meta) {
            return { success: false, message: t('noNoteData') };
        }

        if (entity.type !== 'note' && entity.type !== 'chord') {
            return { success: false, message: t('onlyNoteOrChord', { type: tCommon('tie') }) };
        }

        if (selectedNotesForTie.some(n => n.entity.meta?.id === entity.meta?.id)) {
            return { success: false, message: t('noteAlreadySelected') };
        }

        if (selectedNotesForTie.length === 0) {
            setSelectedNotesForTie([{ entity, location }]);
            return { success: true, message: t('firstNoteSelected') };
        }

        const firstNote = selectedNotesForTie[0];

        // 连音线只需要在同一谱表，允许跨声部（钢琴谱或复杂乐谱场景）
        if (firstNote.location.staveIndex !== location.staveIndex) {
            return { success: false, message: t('mustSameStave', { type: tCommon('tie') }) };
        }

        const getEntityPitches = (e: ScoreEntity): string[] => {
            if (e.type === 'note') return [e.pitch];
            if (e.type === 'chord') return [...e.pitches].sort();
            return [];
        };

        const firstPitches = getEntityPitches(firstNote.entity);
        const secondPitches = getEntityPitches(entity);

        if (JSON.stringify(firstPitches) !== JSON.stringify(secondPitches)) {
            return { success: false, message: t('mustSamePitch') };
        }

        // 检查是否为相邻音符（基于 startTick）
        // 连音线通常连接时间上相邻的音符，如果中间有其他音符，发出警告
        const firstMeta = firstNote.entity.meta!;
        const secondMeta = entity.meta!;
        const getGlobalTick = (meta: { measureIndex: number; startTick?: number }) =>
            meta.measureIndex * 1000000 + (meta.startTick ?? 0);

        const firstTick = getGlobalTick(firstMeta);
        const secondTick = getGlobalTick(secondMeta);
        const [earlierTick, laterTick] = firstTick < secondTick
            ? [firstTick, secondTick]
            : [secondTick, firstTick];

        // 检查两个音符之间是否有其他音符（同谱表内）
        if (scoreData) {
            let hasIntermediateNotes = false;
            for (const measure of scoreData.measures) {
                for (const stave of measure.staves) {
                    // 只检查同一谱表
                    if (stave.name !== scoreData.measures[firstMeta.measureIndex]?.staves[firstMeta.staveIndex]?.name) {
                        continue;
                    }
                    for (const voice of stave.voices) {
                        for (const note of voice.notes) {
                            if (note.meta && note.type !== 'rest' && note.type !== 'blank') {
                                const noteTick = getGlobalTick(note.meta);
                                if (noteTick > earlierTick && noteTick < laterTick) {
                                    hasIntermediateNotes = true;
                                    break;
                                }
                            }
                        }
                        if (hasIntermediateNotes) break;
                    }
                    if (hasIntermediateNotes) break;
                }
                if (hasIntermediateNotes) break;
            }

            if (hasIntermediateNotes) {
                // 阻止创建：连音线必须连接相邻音符
                setSelectedNotesForTie([]);
                return { success: false, message: t('mustAdjacentNotes') };
            }
        }

        // addTieElementsToXML 会根据 startTick 自动确定顺序，无需手动检查

        updateMusicXML((xmlDoc) => {
            addTieElementsToXML(xmlDoc, firstNote.entity.meta!, entity.meta!);
        }, t('addTie'));

        setSelectedNotesForTie([]);
        return { success: true, message: t('tieCreated') };
    };

    // 添加连奏线
    const handleAddSlurSelection = (location: EntityLocation, entity: ScoreEntity): OperationResult => {
        if (!currentXml || !entity.meta) {
            return { success: false, message: t('noNoteData') };
        }

        if (entity.type !== 'note' && entity.type !== 'chord') {
            return { success: false, message: t('onlyNoteOrChord', { type: tCommon('slur') }) };
        }

        if (selectedNotesForSlur.some(n => n.entity.meta?.id === entity.meta?.id)) {
            return { success: false, message: t('noteAlreadySelected') };
        }

        if (selectedNotesForSlur.length === 0) {
            setSelectedNotesForSlur([{ entity, location }]);
            return { success: true, message: t('firstNoteSelected') };
        }

        const firstNote = selectedNotesForSlur[0];

        // 连奏线允许跨谱表和跨声部（钢琴谱场景）
        // addSlurElementsToXML 会根据 startTick 自动确定 start/stop 顺序

        updateMusicXML((xmlDoc) => {
            // addSlurElementsToXML 会自动根据 XML 文档中的实际位置确定 start/stop 顺序
            // 无需在这里手动判断和交换
            addSlurElementsToXML(xmlDoc, firstNote.entity.meta!, entity.meta!);
        }, t('addSlur'));

        setSelectedNotesForSlur([]);
        return { success: true, message: t('slurCreated') };
    };

    return {
        // 选中状态
        selectedNotesForTie,
        selectedNotesForSlur,
        // 清除函数
        clearTieSelection,
        clearSlurSelection,
        // 删除操作
        handleDeleteTie,
        handleDeleteSlur,
        // 添加操作
        handleAddTieSelection,
        handleAddSlurSelection,
    };
}
