import type { ScoreData, Measure, Stave, Voice, ScoreEntity } from '@/types/score-types';
import { buildDirtyMeasureStatuses } from '@/lib/editor/measure-status';
import { parseXml } from './core';

export interface ScoreValidationIssue {
    code: string;
    severity: 'error' | 'warning';
    message: string;
    measureIndex?: number;
    staffIndex?: number;
    voice?: number;
    entityIds?: string[];
    details?: Record<string, string | number>;
}

export interface ValidationResult {
    success: boolean;
    issues: ScoreValidationIssue[];
    warnings: ScoreValidationIssue[];
}

export type TranslateFunction = (key: string) => string;

function errorIssue(code: string, message: string, details?: Record<string, string | number>): ScoreValidationIssue {
    return { code, severity: 'error', message, details };
}

function validateXMLFormat(currentXml: string | null, t: TranslateFunction): ScoreValidationIssue[] {
    const issues: ScoreValidationIssue[] = [];

    if (!currentXml) {
        issues.push(errorIssue('xml.empty', t('validation.xmlEmpty')));
        return issues;
    }

    try {
        const xmlDoc = parseXml(currentXml);
        if (!xmlDoc) {
            issues.push(errorIssue('xml.parse_failed', t('validation.xmlParseFailed')));
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        issues.push(errorIssue('xml.parse_failed', `${t('validation.xmlParseFailed')}: ${reason}`, { reason }));
    }

    return issues;
}

function validateBasicStructure(currentXml: string | null, t: TranslateFunction): ScoreValidationIssue[] {
    const issues: ScoreValidationIssue[] = [];

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
            issues.push(errorIssue('structure.missing_root', t('validation.missingRootElement')));
        }
        const partList = xmlDoc.querySelector('part-list');
        if (!partList) {
            issues.push(errorIssue('structure.missing_part_list', t('validation.missingPartList')));
        }
        const parts = xmlDoc.querySelectorAll('part');
        if (parts.length === 0) {
            issues.push(errorIssue('structure.missing_part', t('validation.missingPart')));
        }
        const measures = xmlDoc.querySelectorAll('measure');
        if (measures.length === 0) {
            issues.push(errorIssue('structure.missing_measure', t('validation.missingMeasure')));
        }

    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        issues.push(errorIssue('xml.parse_failed', `${t('validation.xmlParseFailed')}: ${reason}`, { reason }));
    }

    return issues;
}

function validateMeasureDurations(
    scoreData: ScoreData | null,
    currentXml: string | null,
    t: TranslateFunction
): ScoreValidationIssue[] {
    const warnings: ScoreValidationIssue[] = [];

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
        buildDirtyMeasureStatuses(scoreData, divisions).forEach((measureStatus) => {
            measureStatus.voices.forEach((voiceStatus) => {
                const status = voiceStatus.kind === 'overflow'
                    ? t('editor.durationExceeds')
                    : t('editor.durationInsufficient');
                const staffLabel = voiceStatus.staveIndex === 0
                    ? t('editor.trebleClef')
                    : t('editor.bassClef');
                warnings.push({
                    code: `measure.duration_${voiceStatus.kind}`,
                    severity: 'warning',
                    message: `${t('common.measure')}${voiceStatus.measureNumber} ${staffLabel} ${t('common.voice')}${voiceStatus.xmlVoice}: ${status} (${voiceStatus.actualTicks}/${voiceStatus.expectedTicks})`,
                    measureIndex: voiceStatus.measureIndex,
                    staffIndex: voiceStatus.staveIndex,
                    voice: voiceStatus.xmlVoice,
                    details: {
                        expectedTicks: voiceStatus.expectedTicks,
                        actualTicks: voiceStatus.actualTicks,
                        deltaTicks: voiceStatus.deltaTicks,
                    },
                });
            });
        });
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        warnings.push({ code: 'xml.parse_failed', severity: 'warning', message: `${t('validation.xmlParseFailed')}: ${reason}`, details: { reason } });
    }

    return warnings;
}

function validateUnpairedConnections(scoreData: ScoreData | null, t: TranslateFunction): ScoreValidationIssue[] {
    const warnings: ScoreValidationIssue[] = [];

    if (!scoreData?.connections?.noteConnections || !scoreData?.connections?.entityInfoMap) {
        return warnings;
    }

    const { noteConnections, entityInfoMap } = scoreData.connections;
    scoreData.measures.forEach((measure: Measure, measureIndex: number) => {
        measure.staves.forEach((stave: Stave, staveIndex: number) => {
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
                            warnings.push({ code: 'connection.unpaired_beam', severity: 'warning', message: `${t('validation.unpairedBeam')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`, measureIndex, staffIndex: staveIndex, voice: entityInfo.voiceNumber, entityIds: [entityId] });
                        }
                    }
                    if (articulation.includes('tie')) {
                        const pairedTies = entityConns?.ties?.length ?? 0;
                        if (pairedTies === 0 && entityInfo) {
                            warnings.push({ code: 'connection.unpaired_tie', severity: 'warning', message: `${t('validation.unpairedTie')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`, measureIndex, staffIndex: staveIndex, voice: entityInfo.voiceNumber, entityIds: [entityId] });
                        }
                    }
                    if (articulation.includes('slur')) {
                        const pairedSlurs = entityConns?.slurs?.length ?? 0;
                        if (pairedSlurs === 0 && entityInfo) {
                            warnings.push({ code: 'connection.unpaired_slur', severity: 'warning', message: `${t('validation.unpairedSlur')}: ${entityInfo.pitch} (${t('common.measure')}${entityInfo.measureNumber} | ${getStaveLabel(entityInfo.staveLabel)} | ${t('common.voice')}${entityInfo.voiceNumber} | ${t('common.position')}${entityInfo.position})`, measureIndex, staffIndex: staveIndex, voice: entityInfo.voiceNumber, entityIds: [entityId] });
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
    const issues: ScoreValidationIssue[] = [];
    const warnings: ScoreValidationIssue[] = [];
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

