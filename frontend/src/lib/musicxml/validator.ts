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

function formatIssueLocation(
    t: TranslateFunction,
    measureNumber: number,
    staffLabel: string,
    voice: number
): string {
    return `${t('common.measure')}${measureNumber} ${staffLabel} ${t('common.voice')}${voice}`;
}

function errorIssue(code: string, message: string, details?: Record<string, string | number>): ScoreValidationIssue {
    return { code, severity: 'error', message, details };
}

function formatXmlPitch(note: Element): string | null {
    const step = note.querySelector(':scope > pitch > step')?.textContent?.trim();
    const octave = note.querySelector(':scope > pitch > octave')?.textContent?.trim();
    if (!step || !octave) return null;
    const alter = Number.parseInt(note.querySelector(':scope > pitch > alter')?.textContent ?? '0', 10);
    const accidental = alter > 0 ? '#'.repeat(alter) : alter < 0 ? 'b'.repeat(-alter) : '';
    return `${step}${accidental}${octave}`;
}

function formatBeamEventPitches(note: Element): string | null {
    let root = note;
    while (root.querySelector(':scope > chord')) {
        const previous = root.previousElementSibling;
        if (!previous || previous.tagName !== 'note') break;
        root = previous;
    }

    const notes = [root];
    let sibling = root.nextElementSibling;
    while (sibling?.tagName === 'note' && sibling.querySelector(':scope > chord')) {
        notes.push(sibling);
        sibling = sibling.nextElementSibling;
    }
    const pitches = notes.map(formatXmlPitch).filter((pitch): pitch is string => Boolean(pitch));
    return pitches.length > 0 ? pitches.join('+') : null;
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
        issues.push(errorIssue('xml.parse_failed', t('validation.xmlParseFailed'), { reason }));
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
        issues.push(errorIssue('xml.parse_failed', t('validation.xmlParseFailed'), { reason }));
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
                    message: `${t('common.measure')}${voiceStatus.measureNumber} ${staffLabel} ${t('common.voice')}${voiceStatus.xmlVoice}: ${status}`,
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
        warnings.push({ code: 'xml.parse_failed', severity: 'warning', message: t('validation.xmlParseFailed'), details: { reason } });
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
                    const location = entityInfo
                        ? formatIssueLocation(t, entityInfo.measureNumber, getStaveLabel(entityInfo.staveLabel), entityInfo.voiceNumber)
                        : null;
                    if (articulation.includes('tie')) {
                        const pairedTies = entityConns?.ties?.length ?? 0;
                        if (pairedTies === 0 && entityInfo) {
                            warnings.push({ code: 'connection.unpaired_tie', severity: 'warning', message: `${location}: ${t('validation.unpairedTie')} (${entityInfo.pitch})`, measureIndex, staffIndex: staveIndex, voice: entityInfo.voiceNumber, entityIds: [entityId] });
                        }
                    }
                    if (articulation.includes('slur')) {
                        const pairedSlurs = entityConns?.slurs?.length ?? 0;
                        if (pairedSlurs === 0 && entityInfo) {
                            warnings.push({ code: 'connection.unpaired_slur', severity: 'warning', message: `${location}: ${t('validation.unpairedSlur')} (${entityInfo.pitch})`, measureIndex, staffIndex: staveIndex, voice: entityInfo.voiceNumber, entityIds: [entityId] });
                        }
                    }
                });
            });
        });
    });

    return warnings;
}

function validateBeamStructure(currentXml: string | null, t: TranslateFunction): ScoreValidationIssue[] {
    if (!currentXml) return [];
    const warnings: ScoreValidationIssue[] = [];
    const xmlDoc = parseXml(currentXml);

    xmlDoc.querySelectorAll('part > measure').forEach((measure, measureIndex) => {
        const open = new Map<string, { entityId: string; staff: number; voice: number; pitchLabel: string | null }>();
        measure.querySelectorAll(':scope > note').forEach((note, noteIndex) => {
            if (note.querySelector(':scope > chord')) return;
            const staff = Number.parseInt(note.querySelector(':scope > staff')?.textContent ?? '1', 10) || 1;
            const voice = Number.parseInt(note.querySelector(':scope > voice')?.textContent ?? '1', 10) || 1;
            const staffLabel = staff === 1 ? t('editor.trebleClef') : t('editor.bassClef');
            const location = formatIssueLocation(t, measureIndex + 1, staffLabel, voice);
            const entityId = note.getAttribute('id') || `measure-${measureIndex}-note-${noteIndex}`;
            const pitchLabel = formatBeamEventPitches(note);
            const beamMessage = `${location}: ${t('validation.unpairedBeam')}${pitchLabel ? ` (${pitchLabel})` : ''}`;
            const beamElements = Array.from(note.querySelectorAll(':scope > beam'));
            const levels = new Set<number>();

            beamElements.forEach((beam) => {
                const level = Number.parseInt(beam.getAttribute('number') ?? '1', 10);
                if (!Number.isInteger(level) || level < 1 || level > 8) {
                    warnings.push({ code: 'beam.invalid_level', severity: 'warning', message: `${location}: ${t('validation.invalidBeamLevel')} (${beam.getAttribute('number') ?? ''})`, measureIndex, staffIndex: staff - 1, voice, entityIds: [entityId], details: { level: beam.getAttribute('number') ?? '' } });
                    return;
                }
                levels.add(level);
                const key = `${staff}:${voice}:${level}`;
                const value = beam.textContent?.trim();
                if (value === 'begin') {
                    if (open.has(key)) warnings.push({ code: 'beam.unpaired_begin', severity: 'warning', message: beamMessage, measureIndex, staffIndex: staff - 1, voice, entityIds: [entityId], details: { level } });
                    open.set(key, { entityId, staff, voice, pitchLabel });
                } else if (value === 'continue') {
                    if (!open.has(key)) warnings.push({ code: 'beam.unpaired_continue', severity: 'warning', message: beamMessage, measureIndex, staffIndex: staff - 1, voice, entityIds: [entityId], details: { level } });
                } else if (value === 'end') {
                    if (!open.delete(key)) warnings.push({ code: 'beam.unpaired_end', severity: 'warning', message: beamMessage, measureIndex, staffIndex: staff - 1, voice, entityIds: [entityId], details: { level } });
                }
            });

            levels.forEach((level) => {
                for (let lower = 1; lower < level; lower += 1) {
                    if (levels.has(lower)) continue;
                    warnings.push({ code: 'beam.level_gap', severity: 'warning', message: `${location}: ${t('validation.beamLevelGap')} (${lower})`, measureIndex, staffIndex: staff - 1, voice, entityIds: [entityId], details: { level, missingLevel: lower } });
                    break;
                }
            });
        });

        open.forEach(({ entityId, staff, voice, pitchLabel }, key) => {
            const level = Number.parseInt(key.split(':').at(-1) ?? '1', 10);
            const staffLabel = staff === 1 ? t('editor.trebleClef') : t('editor.bassClef');
            const location = formatIssueLocation(t, measureIndex + 1, staffLabel, voice);
            warnings.push({ code: 'beam.unpaired_begin', severity: 'warning', message: `${location}: ${t('validation.unpairedBeam')}${pitchLabel ? ` (${pitchLabel})` : ''}`, measureIndex, staffIndex: staff - 1, voice, entityIds: [entityId], details: { level } });
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
        warnings.push(...validateBeamStructure(currentXml, t));
        warnings.push(...validateUnpairedConnections(scoreData, t));
    }

    return {
        success: issues.length === 0,
        issues,
        warnings,
    };
}

