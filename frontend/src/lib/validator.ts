/**
 * MusicXML 数据完整性校验模块
 * 
 * 提供保存前的数据校验功能
 * 
 * @module lib/validator
 */

import type { ScoreData, Measure, Stave, Voice, ScoreEntity } from '@/types/score-types';
import { parseXml } from './musicxml-core';

/**
 * 校验结果类型
 */
export interface ValidationResult {
    /** 是否通过校验（无错误） */
    success: boolean;
    /** 错误列表（阻止保存） */
    issues: string[];
    /** 警告列表（可忽略继续保存） */
    warnings: string[];
}

/**
 * 翻译函数类型
 */
export type TranslateFunction = (key: string) => string;

/**
 * 校验 XML 格式是否正确
 * 错误级别：阻止保存
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
 * 校验 MusicXML 基本结构
 * 错误级别：阻止保存
 */
function validateBasicStructure(currentXml: string | null, t: TranslateFunction): string[] {
    const issues: string[] = [];

    if (!currentXml) {
        return issues; // 已在 validateXMLFormat 中处理
    }

    try {
        const xmlDoc = parseXml(currentXml);
        if (!xmlDoc) {
            return issues; // 已在 validateXMLFormat 中处理
        }

        // 检查根元素
        const scorePartwise = xmlDoc.querySelector('score-partwise');
        if (!scorePartwise) {
            issues.push(t('validation.missingRootElement'));
        }

        // 检查 part-list
        const partList = xmlDoc.querySelector('part-list');
        if (!partList) {
            issues.push(t('validation.missingPartList'));
        }

        // 检查至少有一个 part
        const parts = xmlDoc.querySelectorAll('part');
        if (parts.length === 0) {
            issues.push(t('validation.missingPart'));
        }

        // 检查至少有一个 measure
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
 * 获取时值的 divisions 值
 */
function getDurationDivisions(duration: string, divisions: number): number {
    const durationMap: Record<string, number> = {
        'durationWhole': divisions * 4,      // 全音符 = 4拍
        'durationHalf': divisions * 2,       // 二分音符 = 2拍
        'durationQuarter': divisions,        // 四分音符 = 1拍
        'durationEighth': divisions / 2,     // 八分音符 = 0.5拍
        'duration16th': divisions / 4,       // 十六分音符 = 0.25拍
        'duration32nd': divisions / 8,       // 三十二分音符 = 0.125拍
    };
    return durationMap[duration] ?? divisions;
}

/**
 * 校验小节时长
 * 警告级别：可忽略继续保存
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

        // 获取 divisions
        const divisionsEl = xmlDoc.querySelector('attributes divisions');
        const divisions = divisionsEl ? parseInt(divisionsEl.textContent || '4', 10) : 4;

        // 获取拍号
        const beatsEl = xmlDoc.querySelector('time beats');
        const beatTypeEl = xmlDoc.querySelector('time beat-type');
        const beats = beatsEl ? parseInt(beatsEl.textContent || '4', 10) : 4;
        const beatType = beatTypeEl ? parseInt(beatTypeEl.textContent || '4', 10) : 4;

        // 计算每小节的目标 ticks
        const measureTicks = Math.round(divisions * beats * (4 / beatType));

        // 遍历每个小节
        scoreData.measures.forEach((measure: Measure, measureIndex: number) => {
            measure.staves.forEach((stave: Stave, staveIndex: number) => {
                stave.voices.forEach((voice: Voice) => {
                    // 计算该声部的总时长
                    let totalTicks = 0;
                    voice.notes.forEach((entity: ScoreEntity) => {
                        const durationTicks = getDurationDivisions(entity.duration, divisions);
                        const actualTicks = entity.dotted ? durationTicks * 1.5 : durationTicks;
                        totalTicks += actualTicks;
                    });

                    // 比较与目标时长
                    if (totalTicks !== measureTicks && voice.notes.length > 0) {
                        const delta = totalTicks - measureTicks;
                        const status = delta > 0 ? t('editor.durationExceeds') : t('editor.durationInsufficient');
                        const staffLabel = staveIndex === 0 ? t('editor.trebleClef') : t('editor.bassClef');
                        // 从 voice.name 提取声部编号（格式如 "voiceLabel 1" → "1"）
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
 * 校验未配对的连接线
 * 警告级别：可忽略继续保存
 */
function validateUnpairedConnections(scoreData: ScoreData | null, t: TranslateFunction): string[] {
    const warnings: string[] = [];

    if (!scoreData?.connections?.noteConnections || !scoreData?.connections?.entityInfoMap) {
        return warnings;
    }

    const { noteConnections, entityInfoMap } = scoreData.connections;

    // 遍历所有实体，检查是否有未配对的连接
    scoreData.measures.forEach((measure: Measure) => {
        measure.staves.forEach((stave: Stave) => {
            stave.voices.forEach((voice: Voice) => {
                voice.notes.forEach((entity: ScoreEntity) => {
                    if (!entity.meta?.id) return;

                    const entityId = entity.meta.id;
                    const entityConns = noteConnections.get(entityId);
                    const entityInfo = entityInfoMap.get(entityId);

                    // 获取 articulation 中声明的连接类型
                    const articulation = 'articulation' in entity ? (entity.articulation || []) : [];

                    // 翻译谱表标签
                    const getStaveLabel = (label: string) => t(`editor.${label}` as any);

                    // 检查 beam
                    if (articulation.includes('beam')) {
                        const pairedBeams = entityConns?.beams?.length ?? 0;
                        if (pairedBeams === 0 && entityInfo) {
                            warnings.push(
                                `${t('validation.unpairedBeam')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`
                            );
                        }
                    }

                    // 检查 tie
                    if (articulation.includes('tie')) {
                        const pairedTies = entityConns?.ties?.length ?? 0;
                        if (pairedTies === 0 && entityInfo) {
                            warnings.push(
                                `${t('validation.unpairedTie')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`
                            );
                        }
                    }

                    // 检查 slur
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
 * 执行完整的数据完整性校验
 * 
 * @param scoreData - 乐谱数据
 * @param currentXml - 当前 XML 内容
 * @param t - 翻译函数
 * @returns 校验结果
 */
export function validateDataIntegrity(
    scoreData: ScoreData | null,
    currentXml: string | null,
    t: TranslateFunction
): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // 错误级别校验
    issues.push(...validateXMLFormat(currentXml, t));
    issues.push(...validateBasicStructure(currentXml, t));

    // 警告级别校验（只有在无错误时才执行，避免重复错误）
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

