/**
 * MusicXML 扁平化工具
 * 
 * 将多声部扁平化为单声部（去复调合并）：
 * - 高音谱表所有声部 → voice=1
 * - 低音谱表所有声部 → voice=5
 */

import { parseXml, serializeXml } from './core';

/**
 * 音符信息类型
 */
type NoteInfo = {
    absoluteTime: number;
    note: Element;
    duration: number;
    isChord: boolean;
    originalVoice: number;
    originalIndex: number;
};

/**
 * 和弦组类型
 */
type ChordGroup = {
    mainNote: NoteInfo;
    chordMembers: NoteInfo[];
};

/**
 * 获取元素的 duration 值
 */
function getDuration(node: Element): number {
    const durationEl = node.querySelector('duration');
    return durationEl ? parseInt(durationEl.textContent || '0', 10) : 0;
}

/**
 * 获取元素的 staff 值
 */
function getStaff(node: Element): number {
    const staffEl = node.querySelector('staff');
    return staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
}

/**
 * 获取元素的 voice 值
 */
function getVoice(node: Element): number {
    const voiceEl = node.querySelector('voice');
    return voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
}

/**
 * 判断是否是和弦成员
 */
function isChordMember(node: Element): boolean {
    return !!node.querySelector('chord');
}

/**
 * 判断是否是装饰音
 */
function isGrace(node: Element): boolean {
    return !!node.querySelector('grace');
}

/**
 * 处理单个小节的扁平化
 */
function flattenMeasureToSingleVoice(xmlDoc: XMLDocument, measureEl: Element): void {

    // 按 staff 分组存储音符
    const notesByStaff = new Map<number, NoteInfo[]>();

    // 声部时间游标
    const voiceCursors = new Map<number, number>();
    const getVC = (v: number): number => voiceCursors.get(v) ?? 0;
    const setVC = (v: number, pos: number): void => { voiceCursors.set(v, pos); };

    const ensureList = (staff: number): NoteInfo[] => {
        if (!notesByStaff.has(staff)) notesByStaff.set(staff, []);
        return notesByStaff.get(staff)!;
    };

    // 遍历小节内所有子元素
    const children = Array.from(measureEl.childNodes);
    let currentProcessingVoice: number | null = null;

    for (let i = 0; i < children.length; i++) {
        const node = children[i];
        if (node.nodeType !== 1) continue;
        const element = node as Element;
        const tag = element.tagName;

        if (tag === 'note') {
            const staff = getStaff(element);
            const voice = getVoice(element);
            const duration = isGrace(element) ? 0 : getDuration(element);
            const isChord = isChordMember(element);
            currentProcessingVoice = voice;
            const absoluteTime = getVC(voice);

            // 克隆音符并修改 voice
            const copy = element.cloneNode(true) as Element;
            let voiceEl = copy.querySelector('voice');
            if (!voiceEl) {
                voiceEl = xmlDoc.createElement('common.voice');
                copy.appendChild(voiceEl);
            }
            // 高音谱表 voice=1，低音谱表 voice=5
            voiceEl.textContent = staff === 2 ? '5' : '1';

            ensureList(staff).push({
                absoluteTime,
                note: copy,
                duration,
                isChord,
                originalVoice: voice,
                originalIndex: i
            });

            if (!isChord) {
                setVC(voice, absoluteTime + duration);
            }

        } else if (tag === 'forward' || tag === 'backup') {
            const amt = getDuration(element);
            const voiceEl = element.querySelector('voice');

            if (voiceEl) {
                const voice = parseInt(voiceEl.textContent || '1', 10);
                const pos = getVC(voice);
                if (tag === 'forward') {
                    setVC(voice, pos + amt);
                } else {
                    const newPos = Math.max(0, pos - amt);
                    setVC(voice, newPos);
                }
            } else {
                // 推断目标 voice
                let targetVoice = currentProcessingVoice;
                if (targetVoice === null) {
                    for (let j = i + 1; j < children.length; j++) {
                        const next = children[j];
                        if (next.nodeType === 1 && (next as Element).tagName === 'note') {
                            targetVoice = getVoice(next as Element);
                            break;
                        }
                    }
                }

                if (targetVoice !== null) {
                    const pos = getVC(targetVoice);
                    if (tag === 'forward') {
                        setVC(targetVoice, pos + amt);
                    } else {
                        const newPos = Math.max(0, pos - amt);
                        setVC(targetVoice, newPos);
                    }
                }
            }
        }
    }

    // 清空小节内所有音符/forward/backup
    Array.from(measureEl.querySelectorAll('note, backup, forward')).forEach(el => el.remove());

    // 按 staff 重新写入音符
    const staffs = Array.from(notesByStaff.keys()).sort((a, b) => a - b);

    for (let staffIdx = 0; staffIdx < staffs.length; staffIdx++) {
        const staff = staffs[staffIdx];
        const notes = notesByStaff.get(staff)!;

        // 按原始索引排序
        notes.sort((a, b) => a.originalIndex - b.originalIndex);

        // 分组和弦
        const chordGroups: ChordGroup[] = [];
        let currentGroup: ChordGroup | null = null;

        for (const noteInfo of notes) {
            if (noteInfo.isChord) {
                if (currentGroup) {
                    currentGroup.chordMembers.push(noteInfo);
                } else {
                    // 孤立的和弦成员，转换为主音符
                    console.warn(`[FLATTEN] staff ${staff}: 发现孤立的和弦成员，将其转换为主音符`);
                    noteInfo.isChord = false;
                    const chordEl = noteInfo.note.querySelector('chord');
                    if (chordEl) chordEl.remove();
                    currentGroup = { mainNote: noteInfo, chordMembers: [] };
                    chordGroups.push(currentGroup);
                }
            } else {
                currentGroup = { mainNote: noteInfo, chordMembers: [] };
                chordGroups.push(currentGroup);
            }
        }

        // 按 absoluteTime 排序
        chordGroups.sort((a, b) => {
            if (a.mainNote.absoluteTime !== b.mainNote.absoluteTime) {
                return a.mainNote.absoluteTime - b.mainNote.absoluteTime;
            }
            return a.mainNote.originalIndex - b.mainNote.originalIndex;
        });

        // 写入音符
        let writeCursor = 0;
        const targetVoice = staff === 2 ? 5 : 1;

        for (const group of chordGroups) {
            const startTime = group.mainNote.absoluteTime;

            // 如果有间隙，添加 forward
            if (startTime > writeCursor) {
                const gap = startTime - writeCursor;
                const forward = xmlDoc.createElement('forward');
                const duration = xmlDoc.createElement('duration');
                duration.textContent = String(gap);
                forward.appendChild(duration);

                const staffEl = xmlDoc.createElement('staff');
                staffEl.textContent = String(staff);
                forward.appendChild(staffEl);

                const voiceEl = xmlDoc.createElement('common.voice');
                voiceEl.textContent = String(targetVoice);
                forward.appendChild(voiceEl);

                measureEl.appendChild(forward);
                writeCursor = startTime;
            }

            // 写入主音符
            measureEl.appendChild(group.mainNote.note);
            writeCursor += group.mainNote.duration;

            // 写入和弦成员
            for (const member of group.chordMembers) {
                measureEl.appendChild(member.note);
            }
        }

        // 如果不是最后一个 staff，添加 backup
        if (staffIdx < staffs.length - 1 && writeCursor > 0) {
            const backup = xmlDoc.createElement('backup');
            const duration = xmlDoc.createElement('duration');
            duration.textContent = String(writeCursor);
            backup.appendChild(duration);
            measureEl.appendChild(backup);
        }
    }
}

/**
 * 清理 XML 结构
 */
function cleanupXMLStructure(xmlDoc: XMLDocument): void {
    // 清理空的 forward/backup
    Array.from(xmlDoc.querySelectorAll('forward, backup')).forEach(el => {
        const duration = parseInt(el.querySelector('duration')?.textContent || '0', 10);
        if (duration <= 0) el.remove();
    });

    // 确保所有音符都有 voice 元素
    Array.from(xmlDoc.querySelectorAll('note')).forEach(note => {
        if (!note.querySelector('voice')) {
            const voice = xmlDoc.createElement('common.voice');
            voice.textContent = '1';
            note.appendChild(voice);
        }
    });

    // 验证和弦结构
    Array.from(xmlDoc.querySelectorAll('measure')).forEach(measure => {
        const notes = Array.from(measure.querySelectorAll('note'));
        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            if (note.querySelector('chord')) {
                let hasMain = false;
                for (let j = i - 1; j >= 0; j--) {
                    const prev = notes[j];
                    if (!prev.querySelector('chord')) {
                        hasMain = true;
                        break;
                    }
                }
                if (!hasMain) {
                    const chordEl = note.querySelector('chord');
                    if (chordEl) chordEl.remove();
                }
            }
        }
    });
}

/**
 * 扁平化所有小节
 * 
 * @param xmlString 原始 XML 字符串
 * @returns 处理后的 XML 字符串
 */
export function flattenAllMeasures(xmlString: string): string {
    const xmlDoc = parseXml(xmlString);

    const measures = Array.from(xmlDoc.querySelectorAll('measure'));
    measures.forEach(m => flattenMeasureToSingleVoice(xmlDoc, m));

    // 清理结构
    cleanupXMLStructure(xmlDoc);

    // 清理 forward/backup 的多余子元素
    Array.from(xmlDoc.querySelectorAll('forward, backup')).forEach(el => {
        // 移除所有属性
        if (el.attributes && el.attributes.length) {
            Array.from(el.attributes).forEach(a => el.removeAttribute(a.name));
        }
        // 只保留 duration
        Array.from(el.childNodes).forEach(ch => {
            if (ch.nodeType === 1 && (ch as Element).tagName !== 'duration') {
                el.removeChild(ch);
            }
        });
    });

    return serializeXml(xmlDoc);
}
