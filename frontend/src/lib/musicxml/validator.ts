import type { ScoreData, Measure, Stave, Voice, ScoreEntity } from '@/types/score-types';
import { parseXml } from './core';

export interface ValidationResult {
    success: boolean;
    issues: string[];
    warnings: string[];
}

export type TranslateFunction = (key: string) => string;

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

function validateBasicStructure(currentXml: string | null, t: TranslateFunction): string[] {
    const issues: string[] = [];

    if (!currentXml) {
        return issues;
    }

    try {
        const xmlDoc = parseXml(currentXml);
        if (!xmlDoc) {
            return issues;
        }
        const scorePartwise = xmlDoc.querySelector('score-partwise');
        if (!scorePartwise) {
            issues.push(t('validation.missingRootElement'));
        }
        const partList = xmlDoc.querySelector('part-list');
        if (!partList) {
            issues.push(t('validation.missingPartList'));
        }
        const parts = xmlDoc.querySelectorAll('part');
        if (parts.length === 0) {
            issues.push(t('validation.missingPart'));
        }
        const measures = xmlDoc.querySelectorAll('measure');
        if (measures.length === 0) {
            issues.push(t('validation.missingMeasure'));
        }

    } catch (error) {
        issues.push(`${t('validation.xmlParseFailed')}: ${error instanceof Error ? error.message : String(error)}`);
    }

    return issues;
}

function getDurationDivisions(duration: string, divisions: number): number {
    const durationMap: Record<string, number> = {
        'durationWhole': divisions * 4,
        'durationHalf': divisions * 2,
        'durationQuarter': divisions,
        'durationEighth': divisions / 2,
        'duration16th': divisions / 4,
        'duration32nd': divisions / 8,
    };
    return durationMap[duration] ?? divisions;
}

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
        const divisionsEl = xmlDoc.querySelector('attributes divisions');
        const divisions = divisionsEl ? parseInt(divisionsEl.textContent || '4', 10) : 4;
        const beatsEl = xmlDoc.querySelector('time beats');
        const beatTypeEl = xmlDoc.querySelector('time beat-type');
        const beats = beatsEl ? parseInt(beatsEl.textContent || '4', 10) : 4;
        const beatType = beatTypeEl ? parseInt(beatTypeEl.textContent || '4', 10) : 4;
        const measureTicks = Math.round(divisions * beats * (4 / beatType));
        scoreData.measures.forEach((measure: Measure, measureIndex: number) => {
            measure.staves.forEach((stave: Stave, staveIndex: number) => {
                stave.voices.forEach((voice: Voice) => {
                    let totalTicks = 0;
                    voice.notes.forEach((entity: ScoreEntity) => {
                        const durationTicks = getDurationDivisions(entity.duration, divisions);
                        const actualTicks = entity.dotted ? durationTicks * 1.5 : durationTicks;
                        totalTicks += actualTicks;
                    });
                    if (totalTicks !== measureTicks && voice.notes.length > 0) {
                        const delta = totalTicks - measureTicks;
                        const status = delta > 0 ? t('editor.durationExceeds') : t('editor.durationInsufficient');
                        const staffLabel = staveIndex === 0 ? t('editor.trebleClef') : t('editor.bassClef');
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

function validateUnpairedConnections(scoreData: ScoreData | null, t: TranslateFunction): string[] {
    const warnings: string[] = [];

    if (!scoreData?.connections?.noteConnections || !scoreData?.connections?.entityInfoMap) {
        return warnings;
    }

    const { noteConnections, entityInfoMap } = scoreData.connections;
    scoreData.measures.forEach((measure: Measure) => {
        measure.staves.forEach((stave: Stave) => {
            stave.voices.forEach((voice: Voice) => {
                voice.notes.forEach((entity: ScoreEntity) => {
                    if (!entity.meta?.id) return;

                    const entityId = entity.meta.id;
                    const entityConns = noteConnections.get(entityId);
                    const entityInfo = entityInfoMap.get(entityId);
                    const articulation = 'articulation' in entity ? (entity.articulation || []) : [];
                    const getStaveLabel = (label: string) => t(`editor.${label}` as never);
                    if (articulation.includes('beam')) {
                        const pairedBeams = entityConns?.beams?.length ?? 0;
                        if (pairedBeams === 0 && entityInfo) {
                            warnings.push(
                                `${t('validation.unpairedBeam')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`
                            );
                        }
                    }
                    if (articulation.includes('tie')) {
                        const pairedTies = entityConns?.ties?.length ?? 0;
                        if (pairedTies === 0 && entityInfo) {
                            warnings.push(
                                `${t('validation.unpairedTie')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`
                            );
                        }
                    }
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

export function validateDataIntegrity(
    scoreData: ScoreData | null,
    currentXml: string | null,
    t: TranslateFunction
): ValidationResult {
    const issues: string[] = [];
    const warnings: string[] = [];
    issues.push(...validateXMLFormat(currentXml, t));
    issues.push(...validateBasicStructure(currentXml, t));
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

