/**
 * MusicXML Connection Operations
 * 
 * Tie/Slur 连接线操作函数
 * 
 * @module lib/musicxml-connections
 */

import type { EntityMeta } from '@/types/score-types';
import { findConnectionNoteElements, orderConnectionEndpoints } from './connection-targets';

export type ConnectionDirection = 'auto' | 'above' | 'below';

export type ConnectionMemberTarget = {
    startSourceId?: string;
    endSourceId?: string;
};

// ============================================================================
// Internal Helper Functions
// ============================================================================

/**
 * 根据位置信息查找 XML 中的 note 元素
 */
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

    const tie = xmlDoc.createElement('tie');
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
function addTiedElementToNote(xmlDoc: XMLDocument, noteElement: Element, tieType: 'start' | 'stop'): void {
    const existingTied = noteElement.querySelector(`notations > tied[type="${tieType}"]`);
    if (existingTied) return;

    let notations = noteElement.querySelector('notations');
    if (!notations) {
        notations = xmlDoc.createElement('notations');
        noteElement.appendChild(notations);
    }

    const tied = xmlDoc.createElement('tied');
    tied.setAttribute('type', tieType);

    notations.appendChild(tied);
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
    slurNumber: number
): void {
    let notations = noteElement.querySelector('notations');
    if (!notations) {
        notations = xmlDoc.createElement('notations');
        noteElement.appendChild(notations);
    }

    const slur = xmlDoc.createElement('slur');
    slur.setAttribute('type', slurType);
    slur.setAttribute('number', slurNumber.toString());

    notations.appendChild(slur);
}

function removeTypedTieFromNote(noteElement: Element, tieType: 'start' | 'stop'): void {
    noteElement.querySelectorAll(`tie[type="${tieType}"]`).forEach(tie => tie.parentNode?.removeChild(tie));
    noteElement.querySelectorAll(`notations > tied[type="${tieType}"]`).forEach(tied => {
        const parent = tied.parentElement;
        tied.parentNode?.removeChild(tied);
        if (parent && parent.children.length === 0) parent.remove();
    });
}

function removeTypedSlurFromNote(noteElement: Element, slurType: 'start' | 'stop', slurNumber: string): void {
    noteElement.querySelectorAll(`notations > slur[type="${slurType}"][number="${slurNumber}"]`).forEach(slur => {
        const parent = slur.parentElement;
        slur.parentNode?.removeChild(slur);
        if (parent && parent.children.length === 0) parent.remove();
    });
}

function getTieOrientation(direction: ConnectionDirection) {
    if (direction === 'above') return 'over';
    if (direction === 'below') return 'under';
    return null;
}

function getDirectionFromTieOrientation(orientation: string | null): ConnectionDirection {
    if (orientation === 'over') return 'above';
    if (orientation === 'under') return 'below';
    return 'auto';
}

function getDirectionFromSlurPlacement(placement: string | null): ConnectionDirection {
    if (placement === 'above' || placement === 'below') return placement;
    return 'auto';
}

function orderConnectionMemberTargets(
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
) {
    const ordered = orderConnectionEndpoints(startMeta, endMeta);
    const wasReversed = ordered[0] !== startMeta;
    return {
        actualStartMeta: ordered[0],
        actualEndMeta: ordered[1],
        actualStartSourceId: wasReversed ? target.endSourceId : target.startSourceId,
        actualEndSourceId: wasReversed ? target.startSourceId : target.endSourceId,
    };
}

function getConnectionNotes(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
) {
    const {
        actualStartMeta,
        actualEndMeta,
        actualStartSourceId,
        actualEndSourceId,
    } = orderConnectionMemberTargets(startMeta, endMeta, target);
    return {
        startNotes: findConnectionNoteElements(
            xmlDoc,
            actualStartMeta.measureIndex,
            actualStartMeta.staveIndex,
            actualStartMeta.xmlVoice,
            actualStartMeta.entityIndex,
            actualStartSourceId
        ),
        endNotes: findConnectionNoteElements(
            xmlDoc,
            actualEndMeta.measureIndex,
            actualEndMeta.staveIndex,
            actualEndMeta.xmlVoice,
            actualEndMeta.entityIndex,
            actualEndSourceId
        ),
    };
}

function findStartSlurNumber(startNote: Element | undefined) {
    return startNote
        ?.querySelector('notations > slur[type="start"][number]')
        ?.getAttribute('number') ?? null;
}

// ============================================================================
// Exported Functions - Remove Connections
// ============================================================================

/**
 * 删除指定实体的所有 tie 连接
 */
export function removeTieElementsFromXML(
    xmlDoc: XMLDocument,
    entityMetas: EntityMeta[]
): void {
    for (const meta of entityMetas) {
        const notes = findConnectionNoteElements(
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
        const notes = findConnectionNoteElements(
            xmlDoc,
            meta.measureIndex,
            meta.staveIndex,
            meta.xmlVoice,
            meta.entityIndex
        );
        notes.forEach(note => removeSlurFromNote(note));
    }
}

export function removeTieConnectionFromXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
): void {
    const { startNotes, endNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);

    const maxNotes = Math.min(startNotes.length, endNotes.length);
    for (let i = 0; i < maxNotes; i++) {
        removeTypedTieFromNote(startNotes[i], 'start');
        removeTypedTieFromNote(endNotes[i], 'stop');
    }
}

export function removeSlurConnectionFromXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
): void {
    const { startNotes, endNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);
    const startSlur = startNotes[0]?.querySelector('notations > slur[type="start"][number]');
    const number = startSlur?.getAttribute('number');
    if (!number) return;

    removeTypedSlurFromNote(startNotes[0], 'start', number);
    removeTypedSlurFromNote(endNotes[0], 'stop', number);
}

export function getTieConnectionDirectionFromXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
): ConnectionDirection {
    const { startNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);
    const tied = startNotes[0]?.querySelector('notations > tied[type="start"]');
    return getDirectionFromTieOrientation(tied?.getAttribute('orientation') ?? null);
}

export function setTieConnectionDirectionInXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    direction: ConnectionDirection,
    target: ConnectionMemberTarget = {}
): void {
    const { startNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);
    const orientation = getTieOrientation(direction);

    startNotes.forEach((note) => {
        let tied = note.querySelector('notations > tied[type="start"]');
        if (!tied && direction !== 'auto') {
            addTiedElementToNote(xmlDoc, note, 'start');
            tied = note.querySelector('notations > tied[type="start"]');
        }
        if (!tied) return;
        if (orientation) {
            tied.setAttribute('orientation', orientation);
        } else {
            tied.removeAttribute('orientation');
        }
    });
}

export function getSlurConnectionDirectionFromXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
): ConnectionDirection {
    const { startNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);
    const slur = startNotes[0]?.querySelector('notations > slur[type="start"][number]');
    return getDirectionFromSlurPlacement(slur?.getAttribute('placement') ?? null);
}

export function setSlurConnectionDirectionInXML(
    xmlDoc: XMLDocument,
    startMeta: EntityMeta,
    endMeta: EntityMeta,
    direction: ConnectionDirection,
    target: ConnectionMemberTarget = {}
): void {
    const { startNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);
    const number = findStartSlurNumber(startNotes[0]);
    if (!number) return;

    const slur = startNotes[0]?.querySelector(`notations > slur[type="start"][number="${number}"]`);
    if (!slur) return;
    if (direction === 'auto') {
        slur.removeAttribute('placement');
    } else {
        slur.setAttribute('placement', direction);
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
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
): void {
    const { startNotes, endNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);

    if (startNotes.length === 0 || endNotes.length === 0) {
        return;
    }

    const maxNotes = Math.min(startNotes.length, endNotes.length);

    for (let i = 0; i < maxNotes; i++) {
        addTieElementToNote(xmlDoc, startNotes[i], 'start');
        addTiedElementToNote(xmlDoc, startNotes[i], 'start');

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
    endMeta: EntityMeta,
    target: ConnectionMemberTarget = {}
): void {
    const { startNotes, endNotes } = getConnectionNotes(xmlDoc, startMeta, endMeta, target);

    if (startNotes.length === 0 || endNotes.length === 0) {
        return;
    }

    const slurNumber = getNextSlurNumber(xmlDoc);

    addSlurElementToNote(xmlDoc, startNotes[0], 'start', slurNumber);
    addSlurElementToNote(xmlDoc, endNotes[0], 'stop', slurNumber);
}

