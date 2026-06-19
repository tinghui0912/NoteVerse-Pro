/**
 * MusicXML 鏁版嵁瀹屾暣鎬ф牎楠屾ā鍧?
 * 
 * 鎻愪緵淇濆瓨鍓嶇殑鏁版嵁鏍￠獙鍔熻兘
 * 
 * @module lib/validator
 */

import type { ScoreData, Measure, Stave, Voice, ScoreEntity } from '@/types/score-types';
import { parseXml } from './core';

/**
 * 鏍￠獙缁撴灉绫诲瀷
 */
export interface ValidationResult {
    /** 鏄惁閫氳繃鏍￠獙锛堟棤閿欒锛?*/
    success: boolean;
    /** 閿欒鍒楄〃锛堥樆姝繚瀛橈級 */
    issues: string[];
    /** 璀﹀憡鍒楄〃锛堝彲蹇界暐缁х画淇濆瓨锛?*/
    warnings: string[];
}

/**
 * 缈昏瘧鍑芥暟绫诲瀷
 */
export type TranslateFunction = (key: string) => string;

/**
 * 鏍￠獙 XML 鏍煎紡鏄惁姝ｇ‘
 * 閿欒绾у埆锛氶樆姝繚瀛?
 */
function validateXMLFormat(currentXml: string | null, t: TranslateFunction): string[] {
    const issues: string[] = [];

    if (!currentXml) {
        issues.push(t('validation.xmlEmpty'));
        return issues;
    }

    try {
        const xmlDoc = parseXml(currentXml);
        if (!xmlDoc) {
            issues.push(t('validation.xmlParseFailed'));
        }
    } catch (error) {
        issues.push(`${t('validation.xmlParseFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return issues;
}

/**
 * 鏍￠獙 MusicXML 鍩烘湰缁撴瀯
 * 閿欒绾у埆锛氶樆姝繚瀛?
 */
function validateBasicStructure(currentXml: string | null, t: TranslateFunction): string[] {
    const issues: string[] = [];

    if (!currentXml) {
        return issues; // 宸插湪 validateXMLFormat 涓鐞?
    }

    try {
        const xmlDoc = parseXml(currentXml);
        if (!xmlDoc) {
            return issues; // 宸插湪 validateXMLFormat 涓鐞?
        }

        // 妫€鏌ユ牴鍏冪礌
        const scorePartwise = xmlDoc.querySelector('score-partwise');
        if (!scorePartwise) {
            issues.push(t('validation.missingRootElement'));
        }

        // 妫€鏌?part-list
        const partList = xmlDoc.querySelector('part-list');
        if (!partList) {
            issues.push(t('validation.missingPartList'));
        }

        // 妫€鏌ヨ嚦灏戞湁涓€涓?part
        const parts = xmlDoc.querySelectorAll('part');
        if (parts.length === 0) {
            issues.push(t('validation.missingPart'));
        }

        // 妫€鏌ヨ嚦灏戞湁涓€涓?measure
        const measures = xmlDoc.querySelectorAll('measure');
        if (measures.length === 0) {
            issues.push(t('validation.missingMeasure'));
        }

    } catch (error) {
        issues.push(`${t('validation.xmlParseFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return issues;
}

/**
 * 鑾峰彇鏃跺€肩殑 divisions 鍊?
 */
function getDurationDivisions(duration: string, divisions: number): number {
    const durationMap: Record<string, number> = {
        'durationWhole': divisions * 4,      // 鍏ㄩ煶绗?= 4鎷?
        'durationHalf': divisions * 2,       // 浜屽垎闊崇 = 2鎷?
        'durationQuarter': divisions,        // 鍥涘垎闊崇 = 1鎷?
        'durationEighth': divisions / 2,     // 鍏垎闊崇 = 0.5鎷?
        'duration16th': divisions / 4,       // 鍗佸叚鍒嗛煶绗?= 0.25鎷?
        'duration32nd': divisions / 8,       // 涓夊崄浜屽垎闊崇 = 0.125鎷?
    };
    return durationMap[duration] ?? divisions;
}

/**
 * 鏍￠獙灏忚妭鏃堕暱
 * 璀﹀憡绾у埆锛氬彲蹇界暐缁х画淇濆瓨
 */
function validateMeasureDurations(
    scoreData: ScoreData | null,
    currentXml: string | null,
    t: TranslateFunction
): string[] {
    const warnings: string[] = [];

    if (!scoreData || !currentXml) {
        return warnings;
    }

    try {
        const xmlDoc = parseXml(currentXml);
        if (!xmlDoc) {
            return warnings;
        }

        // 鑾峰彇 divisions
        const divisionsEl = xmlDoc.querySelector('attributes divisions');
        const divisions = divisionsEl ? parseInt(divisionsEl.textContent || '4', 10) : 4;

        // 鑾峰彇鎷嶅彿
        const beatsEl = xmlDoc.querySelector('time beats');
        const beatTypeEl = xmlDoc.querySelector('time beat-type');
        const beats = beatsEl ? parseInt(beatsEl.textContent || '4', 10) : 4;
        const beatType = beatTypeEl ? parseInt(beatTypeEl.textContent || '4', 10) : 4;

        // 璁＄畻姣忓皬鑺傜殑鐩爣 ticks
        const measureTicks = Math.round(divisions * beats * (4 / beatType));

        // 閬嶅巻姣忎釜灏忚妭
        scoreData.measures.forEach((measure: Measure, measureIndex: number) => {
            measure.staves.forEach((stave: Stave, staveIndex: number) => {
                stave.voices.forEach((voice: Voice) => {
                    // 璁＄畻璇ュ０閮ㄧ殑鎬绘椂闀?
                    let totalTicks = 0;
                    voice.notes.forEach((entity: ScoreEntity) => {
                        const durationTicks = getDurationDivisions(entity.duration, divisions);
                        const actualTicks = entity.dotted ? durationTicks * 1.5 : durationTicks;
                        totalTicks += actualTicks;
                    });

                    // 姣旇緝涓庣洰鏍囨椂闀?
                    if (totalTicks !== measureTicks && voice.notes.length > 0) {
                        const delta = totalTicks - measureTicks;
                        const status = delta > 0 ? t('editor.durationExceeds') : t('editor.durationInsufficient');
                        const staffLabel = staveIndex === 0 ? t('editor.trebleClef') : t('editor.bassClef');
                        // 浠?voice.name 鎻愬彇澹伴儴缂栧彿锛堟牸寮忓 "voiceLabel 1" 鈫?"1"锛?
                        const voiceNumber = voice.name.replace(/\D/g, '') || '1';
                        warnings.push(
                            `${t('common.measure')}${measureIndex + 1} ${staffLabel} ${t('common.voice')}${voiceNumber}: ${status} (${totalTicks}/${measureTicks})`
                        );
                    }
                });
            });
        });
    } catch (error) {
        warnings.push(`${t('validation.xmlParseFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return warnings;
}

/**
 * 鏍￠獙鏈厤瀵圭殑杩炴帴绾?
 * 璀﹀憡绾у埆锛氬彲蹇界暐缁х画淇濆瓨
 */
function validateUnpairedConnections(scoreData: ScoreData | null, t: TranslateFunction): string[] {
    const warnings: string[] = [];

    if (!scoreData?.connections?.noteConnections || !scoreData?.connections?.entityInfoMap) {
        return warnings;
    }

    const { noteConnections, entityInfoMap } = scoreData.connections;

    // 閬嶅巻鎵€鏈夊疄浣擄紝妫€鏌ユ槸鍚︽湁鏈厤瀵圭殑杩炴帴
    scoreData.measures.forEach((measure: Measure) => {
        measure.staves.forEach((stave: Stave) => {
            stave.voices.forEach((voice: Voice) => {
                voice.notes.forEach((entity: ScoreEntity) => {
                    if (!entity.meta?.id) return;

                    const entityId = entity.meta.id;
                    const entityConns = noteConnections.get(entityId);
                    const entityInfo = entityInfoMap.get(entityId);

                    // 鑾峰彇 articulation 涓０鏄庣殑杩炴帴绫诲瀷
                    const articulation = 'articulation' in entity ? (entity.articulation || []) : [];

                    // 缈昏瘧璋辫〃鏍囩
                    const getStaveLabel = (label: string) => t(`editor.${label}` as never);

                    // 妫€鏌?beam
                    if (articulation.includes('beam')) {
                        const pairedBeams = entityConns?.beams?.length ?? 0;
                        if (pairedBeams === 0 && entityInfo) {
                            warnings.push(
                                `${t('validation.unpairedBeam')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`
                            );
                        }
                    }

                    // 妫€鏌?tie
                    if (articulation.includes('tie')) {
                        const pairedTies = entityConns?.ties?.length ?? 0;
                        if (pairedTies === 0 && entityInfo) {
                            warnings.push(
                                `${t('validation.unpairedTie')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`
                            );
                        }
                    }

                    // 妫€鏌?slur
                    if (articulation.includes('slur')) {
                        const pairedSlurs = entityConns?.slurs?.length ?? 0;
                        if (pairedSlurs === 0 && entityInfo) {
                            warnings.push(
                                `${t('validation.unpairedSlur')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`
                            );
                        }
                    }
                });
            });
        });
    });

    return warnings;
}

/**
 * 鎵ц瀹屾暣鐨勬暟鎹畬鏁存€ф牎楠?
 * 
 * @param scoreData - 涔愯氨鏁版嵁
 * @param currentXml - 褰撳墠 XML 鍐呭
 * @param t - 缈昏瘧鍑芥暟
 * @returns 鏍￠獙缁撴灉
 */
export function validateDataIntegrity(
    scoreData: ScoreData | null,
    currentXml: string | null,
    t: TranslateFunction
): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // 閿欒绾у埆鏍￠獙
    issues.push(...validateXMLFormat(currentXml, t));
    issues.push(...validateBasicStructure(currentXml, t));

    // 璀﹀憡绾у埆鏍￠獙锛堝彧鏈夊湪鏃犻敊璇椂鎵嶆墽琛岋紝閬垮厤閲嶅閿欒锛?
    if (issues.length === 0) {
        warnings.push(...validateMeasureDurations(scoreData, currentXml, t));
        warnings.push(...validateUnpairedConnections(scoreData, t));
    }

    return {
        success: issues.length === 0,
        issues,
        warnings,
    };
}

