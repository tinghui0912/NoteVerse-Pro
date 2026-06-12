'use client';

import { useTranslations } from 'next-intl';

import { useMemo, useCallback } from 'react';
import type { ScoreEntity, Articulation, ConnectionData, TieConnection, SlurConnection, BeamConnection } from '@/types/score-types';

/**
 * 瀹炰綋鍗＄墖鍏叡閫昏緫 Hook
 * 涓?NoteCard 鍜?ChordCard 鎻愪緵鍏变韩鐨勫伐鍏峰嚱鏁? */
export function useEntityCard(entity: ScoreEntity, connections: ConnectionData | undefined) {
    const t = useTranslations('editor');
    const tCommon = useTranslations('common');

    /**
     * 鑾峰彇瀹炰綋鐨勮繛鎺ュ浘鏍囩被鍨?     */
    const getConnectionIconTypes = useMemo((): Articulation[] => {
        const iconTypes: Set<Articulation> = new Set();

        // 娣诲姞鍘熸湁鐨?articulations
        if ('articulation' in entity && entity.articulation) {
            entity.articulation.forEach((a: Articulation) => iconTypes.add(a));
        }

        // 浠?connections 鑾峰彇杩炴帴绫诲瀷
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
     * 鏋勫缓鏃跺€兼樉绀烘枃鏈紙鍚檮鐐癸級
     */
    const getDurationDisplay = useCallback((): string => {
        const baseDuration = t(entity.duration as never);
        return entity.dotted ? `${tCommon('dotted')}${baseDuration}` : baseDuration;
    }, [entity.duration, entity.dotted, t, tCommon]);

    /**
     * 鏍煎紡鍖栧疄浣撲俊鎭紙鐢ㄤ簬 Tooltip锛?     */
    const formatEntityInfo = useCallback((entityId: string, isCurrent: boolean = false): string => {
        const info = connections?.entityInfoMap?.get(entityId);
        if (!info) return entityId;
        const pitchDisplay = isCurrent ? `[${info.pitch}]` : info.pitch;
        const staveKey = info.staveLabel;
        return `${pitchDisplay} (${tCommon('measure')}${info.measureNumber} | ${t(staveKey as never)} | ${tCommon('voice')}${info.voiceNumber} | ${tCommon('position')}${info.position})`;
    }, [connections?.entityInfoMap, t, tCommon]);

    /**
     * 鑾峰彇浣嶇疆淇℃伅琛?     */
    const getPositionLine = useCallback((): string => {
        if (entity.meta?.id && connections?.entityInfoMap) {
            const entityInfo = connections.entityInfoMap.get(entity.meta.id);
            if (entityInfo) {
                const staveKey = entityInfo.staveLabel;
                return `${tCommon('measure')}${entityInfo.measureNumber} | ${t(staveKey as never)} | ${tCommon('voice')}${entityInfo.voiceNumber} | ${tCommon('position')}${entityInfo.position}`;
            }
        }
        if (entity.meta) {
            return `${tCommon('measure')} ${entity.meta.measureIndex + 1} | ${tCommon('position')} ${entity.meta.entityIndex + 1}`;
        }
        return '';
    }, [entity.meta, connections, t, tCommon]);

    /**
     * 鑾峰彇杩炴帴璇︽儏琛岋紙鐢ㄤ簬 Tooltip锛?     */
    const getConnectionLines = useCallback((): string[] => {
        const lines: string[] = [];

        if (!entity.meta?.id || !connections) return lines;

        const entityConns = connections.noteConnections?.get(entity.meta.id);
        const currentId = entity.meta.id;

        // 鑾峰彇宸查厤瀵圭殑杩炴帴鏁伴噺
        const pairedTies = entityConns?.ties?.length ?? 0;
        const pairedSlurs = entityConns?.slurs?.length ?? 0;
        const pairedBeams = entityConns?.beams?.length ?? 0;

        // 鑾峰彇 articulation
        const articulation = 'articulation' in entity ? (entity.articulation || []) : [];
        const hasTieInArticulation = articulation.includes('tie');
        const hasSlurInArticulation = articulation.includes('slur');
        const hasBeamInArticulation = articulation.includes('beam');

        if (entityConns) {
            // 杩為煶绾?
            if (entityConns.ties.length > 0) {
                entityConns.ties.forEach((tie: TieConnection) => {
                    const currentInfo = formatEntityInfo(currentId, true);
                    const partnerInfo = formatEntityInfo(tie.partnerId, false);
                    if (tie.type === 'start') {
                        lines.push(`${tCommon('tie')}: ${currentInfo} 鈫?${partnerInfo}`);
                    } else {
                        lines.push(`${tCommon('tie')}: ${partnerInfo} 鈫?${currentInfo}`);
                    }
                });
            }

            // 杩炲绾?
            if (entityConns.slurs.length > 0) {
                entityConns.slurs.forEach((slur: SlurConnection) => {
                    const pathParts = slur.partnerIds.map((id) =>
                        formatEntityInfo(id, id === currentId)
                    );
                    lines.push(`${tCommon('slur')}: ${pathParts.join(' 鈫?')}`);
                });
            }

            // 杩為煶绗?
            if (entityConns.beams.length > 0) {
                entityConns.beams.forEach((beam: BeamConnection) => {
                    const pathParts = beam.noteIds.map((id) =>
                        formatEntityInfo(id, id === currentId)
                    );
                    lines.push(`${tCommon('beam')}: ${pathParts.join(' 鈫?')}`);
                });
            }
        }

        // 鏈厤瀵硅繛鎺ヨ鍛?
        if (hasTieInArticulation && pairedTies === 0) {
            lines.push(`鈿狅笍 ${tCommon('tie')}: ${t('unpairedConnection')}`);
        }
        if (hasSlurInArticulation && pairedSlurs === 0) {
            lines.push(`鈿狅笍 ${tCommon('slur')}: ${t('unpairedConnection')}`);
        }
        if (hasBeamInArticulation && pairedBeams === 0) {
            lines.push(`鈿狅笍 ${tCommon('beam')}: ${t('unpairedConnection')}`);
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
