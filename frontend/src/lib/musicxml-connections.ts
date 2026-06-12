/**
 * MusicXML Connection Operations
 * 
 * Tie/Slur/Beam 连接线操作函数
 * 
 * @module lib/musicxml-connections
 */

import type { EntityMeta } from '@/types/score-types';

// ============================================================================
// Constants
// ============================================================================

/**
 * 可连音的时值类型（八分音符及更短）
 */
const BEAMABLE_DURATIONS = [
    'durationEighth',   // 八分音符
    'duration16th',     // 十六分音符
    'duration32nd',     // 三十二分音符
];

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * 根据位置信息查找 XML 中的 note 元素
 */
function findNoteElementsByMeta(
    xmlDoc: XMLDocument,
    measureIndex: number,
    staveIndex: number,
    xmlVoice: number,
    entityIndex: number
): Element[] {
    const measures = xmlDoc.querySelectorAll('part > measure');
    if (measureIndex >= measures.length) return [];

    const measureNode = measures[measureIndex];

    const staff = staveIndex + 1;
    const voice = xmlVoice;

    const result: Element[] = [];
    let currentEntityIndex = -1;

    const children = Array.from(measureNode.childNodes);
    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.nodeType !== 1) continue;
        const element = node as Element;

        if (element.tagName === 'note') {
            const noteNode = element;
            const noteStaff = parseInt(noteNode.querySelector('staff')?.textContent || '1', 10);
            const noteVoice = parseInt(noteNode.querySelector('voice')?.textContent || '1', 10);

            if (noteStaff !== staff || noteVoice !== voice) continue;

            const isChordPart = noteNode.querySelector('chord') !== null;

            if (!isChordPart) {
                currentEntityIndex++;
            }

            if (currentEntityIndex === entityIndex) {
                result.push(noteNode);
                if (!isChordPart) {
                    for (let j = i + 1; j < children.length; j++) {
                        const nextNode = children[j];
                        if (nextNode.nodeType !== 1) continue;
                        const nextElement = nextNode as Element;
                        if (nextElement.tagName !== 'note') break;

                        const nextStaff = parseInt(nextElement.querySelector('staff')?.textContent || '1', 10);
                        const nextVoice = parseInt(nextElement.querySelector('voice')?.textContent || '1', 10);
                        if (nextStaff !== staff || nextVoice !== voice) break;
                        if (nextElement.querySelector('chord') === null) break;
                        result.push(nextElement);
                    }
                    return result;
                }
            }
        } else if (element.tagName === 'forward') {
            const forwardStaff = parseInt(element.querySelector('staff')?.textContent || '1', 10);
            const forwardVoice = parseInt(element.querySelector('voice')?.textContent || '1', 10);

            if (forwardStaff === staff && forwardVoice === voice) {
                currentEntityIndex++;
            }
        }
    }

    return result;
}

/**
 * 从 note 元素中删除所有 beam 子元素
 */
function removeBeamFromNote(noteElement: Element): void {
    const beams = noteElement.querySelectorAll('beam');
    beams.forEach(beam => beam.parentNode?.removeChild(beam));
}

/**
 * 从 note 元素中删除所有 tie 子元素
 */
function removeTieFromNote(noteElement: Element): void {
    const ties = noteElement.querySelectorAll('tie');
    ties.forEach(tie => tie.parentNode?.removeChild(tie));
    const tieds = noteElement.querySelectorAll('notations > tied');
    tieds.forEach(tied => tied.parentNode?.removeChild(tied));
}

/**
 * 从 note 元素中删除 slur 子元素
 */
function removeSlurFromNote(noteElement: Element): void {
    const slurs = noteElement.querySelectorAll('notations > slur');
    slurs.forEach(slur => slur.parentNode?.removeChild(slur));
}

/**
 * 为音符元素添加 tie 声音元素
 */
function addTieElementToNote(xmlDoc: XMLDocument, noteElement: Element, tieType: 'start' | 'stop'): void {
    const existingTie = noteElement.querySelector(`tie[type="${tieType}"]`);
    if (existingTie) return;

    const tie = xmlDoc.createElement('common.tie');
    tie.setAttribute('type', tieType);

    const durationElement = noteElement.querySelector('duration');
    const voiceElement = noteElement.querySelector('voice');

    if (durationElement && voiceElement) {
        noteElement.insertBefore(tie, voiceElement);
    } else if (durationElement) {
        durationElement.parentNode?.insertBefore(tie, durationElement.nextSibling);
    } else {
        noteElement.appendChild(tie);
    }
}

/**
 * 为音符元素添加 tied 视觉元素
 */
function addTiedElementToNote(xmlDoc: XMLDocument, noteElement: Element, tieType: 'start' | 'stop', orientation?: 'over' | 'under'): void {
    const existingTied = noteElement.querySelector(`notations > tied[type="${tieType}"]`);
    if (existingTied) return;

    let notations = noteElement.querySelector('notations');
    if (!notations) {
        notations = xmlDoc.createElement('notations');
        noteElement.appendChild(notations);
    }

    const tied = xmlDoc.createElement('tied');
    tied.setAttribute('type', tieType);

    if (tieType === 'start' && orientation) {
        tied.setAttribute('orientation', orientation);
    }

    notations.appendChild(tied);
}

/**
 * 根据符干方向确定连音线朝向
 */
function getStemDirection(noteElement: Element): 'up' | 'down' {
    const stemEl = noteElement.querySelector('stem');
    if (stemEl) {
        const stemText = (stemEl.textContent || '').trim().toLowerCase();
        if (stemText === 'up' || stemText === 'down') {
            return stemText;
        }
    }
    const octaveEl = noteElement.querySelector('pitch > octave');
    const octave = octaveEl ? parseInt(octaveEl.textContent || '4', 10) : 4;
    return octave >= 5 ? 'down' : 'up';
}

/**
 * 获取 XML 文档中下一个可用的 slur 编号
 */
function getNextSlurNumber(xmlDoc: XMLDocument): number {
    const existingSlurs = xmlDoc.querySelectorAll('slur[number]');
    let maxNumber = 0;
    existingSlurs.forEach(slur => {
        const n = parseInt(slur.getAttribute('number') || '0', 10);
        if (n > maxNumber) maxNumber = n;
    });
    return maxNumber + 1;
}

/**
 * 为音符元素添加 slur 元素
 */
function addSlurElementToNote(
    xmlDoc: XMLDocument,
    noteElement: Element,
    slurType: 'start' | 'stop',
    slurNumber: number,
    placement?: 'above' | 'below'
): void {
    let notations = noteElement.querySelector('notations');
    if (!notations) {
        notations = xmlDoc.createElement('notations');
        noteElement.appendChild(notations);
    }

    const slur = xmlDoc.createElement('common.slur');
    slur.setAttribute('type', slurType);
    slur.setAttribute('number', slurNumber.toString());

    if (slurType === 'start' && placement) {
        slur.setAttribute('placement', placement);
    }

    notations.appendChild(slur);
}

/**
 * 为音符元素添加 beam 元素
 */
function addBeamElementToNote(
    xmlDoc: XMLDocument,
    noteElement: Element,
    beamNumber: number,
    beamType: 'begin' | 'continue' | 'end'
): void {
    const beam = xmlDoc.createElement('common.beam');
    beam.setAttribute('number', beamNumber.toString());
    beam.textContent = beamType;

    const staffEl = noteElement.querySelector('staff');
    if (staffEl && staffEl.nextSibling) {
        noteElement.insertBefore(beam, staffEl.nextSibling);
    } else {
        noteElement.appendChild(beam);
    }
}

// ============================================================================
// Exported Functions - Remove Connections
// ============================================================================

/**
 * 删除指定实体的所有 beam 连接
 */
export function removeBeamElementsFromXML(
    xmlDoc: XMLDocument,
    entityMetas: EntityMeta[]
): void {
    for (const meta of entityMetas) {
        const notes = findNoteElementsByMeta(
            xmlDoc,
            meta.measureIndex,
            meta.staveIndex,
            meta.xmlVoice,
            meta.entityIndex
        );
        notes.forEach(note => removeBeamFromNote(note));
    }
}

/**
 * 删除指定实体的所有 tie 连接
 */
export function removeTieElementsFromXML(
    xmlDoc: XMLDocument,
    entityMetas: EntityMeta[]
): void {
    for (const meta of entityMetas) {
        const notes = findNoteElementsByMeta(
            xmlDoc,
            meta.measureIndex,
            meta.staveIndex,
            meta.xmlVoice,
            meta.entityIndex
        );
        notes.forEach(note => removeTieFromNote(note));
    }
}

/**
 * 删除指定实体的所有 slur 连接
 */
export function removeSlurElementsFromXML(
    xmlDoc: XMLDocument,
    entityMetas: EntityMeta[]
): void {
    for (const meta of entityMetas) {
        const notes = findNoteElementsByMeta(
            xmlDoc,
            meta.measureIndex,
            meta.staveIndex,
            meta.xmlVoice,
            meta.entityIndex
        );
        notes.forEach(note => removeSlurFromNote(note));
    }
}

// ============================================================================
// Exported Functions - Add Connections
// ============================================================================

/**
 * 为两个实体添加连音线
 */
export function addTieElementsToXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta
): void {
    const getGlobalTick = (meta: EntityMeta): number => {
        return meta.measureIndex * 1000000 + (meta.startTick ?? 0);
    };

    let actualStartMeta = startMeta;
    let actualEndMeta = endMeta;

    if (getGlobalTick(startMeta) > getGlobalTick(endMeta)) {
        actualStartMeta = endMeta;
        actualEndMeta = startMeta;
    }

    const startNotes = findNoteElementsByMeta(
        xmlDoc,
        actualStartMeta.measureIndex,
        actualStartMeta.staveIndex,
        actualStartMeta.xmlVoice,
        actualStartMeta.entityIndex
    );

    const endNotes = findNoteElementsByMeta(
        xmlDoc,
        actualEndMeta.measureIndex,
        actualEndMeta.staveIndex,
        actualEndMeta.xmlVoice,
        actualEndMeta.entityIndex
    );

    if (startNotes.length === 0 || endNotes.length === 0) {
        console.error('无法找到音符元素');
        return;
    }

    const maxNotes = Math.min(startNotes.length, endNotes.length);

    for (let i = 0; i < maxNotes; i++) {
        let orientation: 'over' | 'under';

        if (maxNotes === 1) {
            const stemDir = getStemDirection(startNotes[i]);
            orientation = stemDir === 'up' ? 'under' : 'over';
        } else {
            if (i === 0) {
                orientation = 'under';
            } else {
                orientation = 'over';
            }
        }

        addTieElementToNote(xmlDoc, startNotes[i], 'start');
        addTiedElementToNote(xmlDoc, startNotes[i], 'start', orientation);

        addTieElementToNote(xmlDoc, endNotes[i], 'stop');
        addTiedElementToNote(xmlDoc, endNotes[i], 'stop');
    }
}

/**
 * 为两个实体添加连奏线
 */
export function addSlurElementsToXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta
): void {
    const getGlobalTick = (meta: EntityMeta): number => {
        return meta.measureIndex * 1000000 + (meta.startTick ?? 0);
    };

    let actualStartMeta = startMeta;
    let actualEndMeta = endMeta;

    if (getGlobalTick(startMeta) > getGlobalTick(endMeta)) {
        actualStartMeta = endMeta;
        actualEndMeta = startMeta;
    }

    const startNotes = findNoteElementsByMeta(
        xmlDoc,
        actualStartMeta.measureIndex,
        actualStartMeta.staveIndex,
        actualStartMeta.xmlVoice,
        actualStartMeta.entityIndex
    );

    const endNotes = findNoteElementsByMeta(
        xmlDoc,
        actualEndMeta.measureIndex,
        actualEndMeta.staveIndex,
        actualEndMeta.xmlVoice,
        actualEndMeta.entityIndex
    );

    if (startNotes.length === 0 || endNotes.length === 0) {
        console.error('无法找到音符元素');
        return;
    }

    const slurNumber = getNextSlurNumber(xmlDoc);

    const stemDir = getStemDirection(startNotes[0]);
    const placement: 'above' | 'below' = stemDir === 'up' ? 'below' : 'above';

    addSlurElementToNote(xmlDoc, startNotes[0], 'start', slurNumber, placement);
    addSlurElementToNote(xmlDoc, endNotes[0], 'stop', slurNumber);
}

/**
 * 为两个实体之间的所有音符添加连音符
 */
export function addBeamElementsToXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta
): void {
    if (startMeta.measureIndex !== endMeta.measureIndex) {
        console.error('连音符不能跨小节');
        return;
    }

    const getGlobalTick = (meta: EntityMeta): number => {
        return meta.measureIndex * 1000000 + (meta.startTick ?? 0);
    };

    let actualStartMeta = startMeta;
    let actualEndMeta = endMeta;

    if (getGlobalTick(startMeta) > getGlobalTick(endMeta)) {
        actualStartMeta = endMeta;
        actualEndMeta = startMeta;
    }

    const measureIndex = actualStartMeta.measureIndex;
    const staveIndex = actualStartMeta.staveIndex;
    const voiceIndex = actualStartMeta.xmlVoice;

    const startEntityIndex = actualStartMeta.entityIndex;
    const endEntityIndex = actualEndMeta.entityIndex;

    const beamNumber = 1;

    for (let entityIndex = startEntityIndex; entityIndex <= endEntityIndex; entityIndex++) {
        const notes = findNoteElementsByMeta(
            xmlDoc,
            measureIndex,
            staveIndex,
            voiceIndex,
            entityIndex
        );

        if (notes.length === 0) continue;

        let beamType: 'begin' | 'continue' | 'end';
        if (entityIndex === startEntityIndex) {
            beamType = 'begin';
        } else if (entityIndex === endEntityIndex) {
            beamType = 'end';
        } else {
            beamType = 'continue';
        }

        notes.forEach(note => {
            addBeamElementToNote(xmlDoc, note, beamNumber, beamType);
        });
    }
}

/**
 * 检查音符时值是否可以添加连音符（八分或更短）
 */
export function isBeamableDuration(duration: string): boolean {
    return BEAMABLE_DURATIONS.includes(duration);
}
