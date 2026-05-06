'use client';

import { useTranslations } from 'next-intl';

import { useMemo, useCallback } from 'react';
import type { ScoreEntity, Articulation, ConnectionData, TieConnection, SlurConnection, BeamConnection } from '@/types/score-types';

/**
 * 实体卡片公共逻辑 Hook
 * 为 NoteCard 和 ChordCard 提供共享的工具函数
 */
export function useEntityCard(entity: ScoreEntity, connections: ConnectionData | undefined) {
    const t = useTranslations('editor');
    const tCommon = useTranslations('common');

    /**
     * 获取实体的连接图标类型
     */
    const getConnectionIconTypes = useMemo((): Articulation[] => {
        const iconTypes: Set<Articulation> = new Set();

        // 添加原有的 articulations
        if ('articulation' in entity && entity.articulation) {
            entity.articulation.forEach((a: Articulation) => iconTypes.add(a));
        }

        // 从 connections 获取连接类型
        if (entity.meta?.id && connections?.noteConnections) {
            const entityConns = connections.noteConnections.get(entity.meta.id);
            if (entityConns) {
                if (entityConns.ties.length > 0) iconTypes.add('tie');
                if (entityConns.slurs.length > 0) iconTypes.add('slur');
                if (entityConns.beams.length > 0) iconTypes.add('beam');
            }
        }

        return Array.from(iconTypes);
    }, [entity, connections]);

    /**
     * 构建时值显示文本（含附点）
     */
    const getDurationDisplay = useCallback((): string => {
        const baseDuration = t(entity.duration as any);
        return entity.dotted ? `${tCommon('dotted')}${baseDuration}` : baseDuration;
    }, [entity.duration, entity.dotted, t, tCommon]);

    /**
     * 格式化实体信息（用于 Tooltip）
     */
    const formatEntityInfo = useCallback((entityId: string, isCurrent: boolean = false): string => {
        const info = connections?.entityInfoMap?.get(entityId);
        if (!info) return entityId;
        const pitchDisplay = isCurrent ? `[${info.pitch}]` : info.pitch;
        const staveKey = info.staveLabel;
        return `${pitchDisplay} (${tCommon('measure')}${info.measureNumber} | ${t(staveKey as any)} | ${tCommon('voice')}${info.voiceNumber} | ${tCommon('position')}${info.position})`;
    }, [connections?.entityInfoMap, t, tCommon]);

    /**
     * 获取位置信息行
     */
    const getPositionLine = useCallback((): string => {
        if (entity.meta?.id && connections?.entityInfoMap) {
            const entityInfo = connections.entityInfoMap.get(entity.meta.id);
            if (entityInfo) {
                const staveKey = entityInfo.staveLabel;
                return `${tCommon('measure')}${entityInfo.measureNumber} | ${t(staveKey as any)} | ${tCommon('voice')}${entityInfo.voiceNumber} | ${tCommon('position')}${entityInfo.position}`;
            }
        }
        if (entity.meta) {
            return `${tCommon('measure')} ${entity.meta.measureIndex + 1} | ${tCommon('position')} ${entity.meta.entityIndex + 1}`;
        }
        return '';
    }, [entity.meta, connections, t, tCommon]);

    /**
     * 获取连接详情行（用于 Tooltip）
     */
    const getConnectionLines = useCallback((): string[] => {
        const lines: string[] = [];

        if (!entity.meta?.id || !connections) return lines;

        const entityConns = connections.noteConnections?.get(entity.meta.id);
        const currentId = entity.meta.id;

        // 获取已配对的连接数量
        const pairedTies = entityConns?.ties?.length ?? 0;
        const pairedSlurs = entityConns?.slurs?.length ?? 0;
        const pairedBeams = entityConns?.beams?.length ?? 0;

        // 获取 articulation
        const articulation = 'articulation' in entity ? (entity.articulation || []) : [];
        const hasTieInArticulation = articulation.includes('tie');
        const hasSlurInArticulation = articulation.includes('slur');
        const hasBeamInArticulation = articulation.includes('beam');

        if (entityConns) {
            // 连音线
            if (entityConns.ties.length > 0) {
                entityConns.ties.forEach((tie: TieConnection) => {
                    const currentInfo = formatEntityInfo(currentId, true);
                    const partnerInfo = formatEntityInfo(tie.partnerId, false);
                    if (tie.type === 'start') {
                        lines.push(`${tCommon('tie')}: ${currentInfo} → ${partnerInfo}`);
                    } else {
                        lines.push(`${tCommon('tie')}: ${partnerInfo} → ${currentInfo}`);
                    }
                });
            }

            // 连奏线
            if (entityConns.slurs.length > 0) {
                entityConns.slurs.forEach((slur: SlurConnection) => {
                    const pathParts = slur.partnerIds.map((id) =>
                        formatEntityInfo(id, id === currentId)
                    );
                    lines.push(`${tCommon('slur')}: ${pathParts.join(' → ')}`);
                });
            }

            // 连音符
            if (entityConns.beams.length > 0) {
                entityConns.beams.forEach((beam: BeamConnection) => {
                    const pathParts = beam.noteIds.map((id) =>
                        formatEntityInfo(id, id === currentId)
                    );
                    lines.push(`${tCommon('beam')}: ${pathParts.join(' → ')}`);
                });
            }
        }

        // 未配对连接警告
        if (hasTieInArticulation && pairedTies === 0) {
            lines.push(`⚠️ ${tCommon('tie')}: ${t('unpairedConnection')}`);
        }
        if (hasSlurInArticulation && pairedSlurs === 0) {
            lines.push(`⚠️ ${tCommon('slur')}: ${t('unpairedConnection')}`);
        }
        if (hasBeamInArticulation && pairedBeams === 0) {
            lines.push(`⚠️ ${tCommon('beam')}: ${t('unpairedConnection')}`);
        }

        return lines;
    }, [entity, connections, formatEntityInfo, t, tCommon]);

    return {
        articulations: getConnectionIconTypes,
        getDurationDisplay,
        formatEntityInfo,
        getPositionLine,
        getConnectionLines,
    };
}
