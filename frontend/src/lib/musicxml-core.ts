/**
 * MusicXML Core Utilities
 * 
 * 基础工具函数：解析、序列化、时值转换等
 * 
 * @module lib/musicxml-core
 */

// ============================================================================
// Constants
// ============================================================================

/** Duration type to MusicXML divisions mapping (assuming divisions=1) */
export const DURATION_MAP: Record<string, number> = {
    durationWhole: 4,
    durationHalf: 2,
    durationQuarter: 1,
    durationEighth: 0.5,
    duration16th: 0.25,
    duration32nd: 0.125,
};

/** Duration type to MusicXML <type> element value mapping */
export const DURATION_TYPE_MAP: Record<string, string> = {
    durationWhole: 'whole',
    durationHalf: 'half',
    durationQuarter: 'quarter',
    durationEighth: 'eighth',
    duration16th: '16th',
    duration32nd: '32nd',
};

// ============================================================================
// XML Parsing and Serialization
// ============================================================================

/**
 * Serialize XMLDocument back to string (with pretty-print formatting)
 */
export function serializeXml(xmlDoc: XMLDocument): string {
    const raw = new XMLSerializer().serializeToString(xmlDoc);
    return formatXml(raw);
}

/**
 * 对 XML 字符串进行缩进格式化。
 * 
 * XMLSerializer 输出的 XML 对于新增/修改的节点不保留缩进，
 * 此函数统一处理，确保保存后的文件可读。
 */
function formatXml(xml: string): string {
    // 提取 XML 声明（如 <?xml version="1.0" ...?>）
    const xmlDeclMatch = xml.match(/^(<\?xml[^?]*\?>)\s*/);
    const xmlDecl = xmlDeclMatch ? xmlDeclMatch[1] : '';
    const body = xmlDeclMatch ? xml.slice(xmlDeclMatch[0].length) : xml;

    // 在相邻标签之间插入换行（仅匹配 >< 之间）
    const formatted = body
        .replace(/>\s*</g, '>\n<')
        .split('\n');

    const indent = '  ';
    let level = 0;
    const result: string[] = [];

    for (const rawLine of formatted) {
        const line = rawLine.trim();
        if (!line) continue;

        // 纯文本行（不以 < 开头）→ 不添加缩进，保持原样
        if (!line.startsWith('<')) {
            result.push(line);
            continue;
        }

        // 自闭合标签 <.../> — 不改变层级
        if (line.match(/^<[^/!][^>]*\/>\s*$/)) {
            result.push(indent.repeat(level) + line);
        }
        // 闭合标签 </...> — 先减层级再缩进
        else if (line.startsWith('</')) {
            level = Math.max(0, level - 1);
            result.push(indent.repeat(level) + line);
        }
        // 开始标签（含内联文本，如 <tag>text</tag>）
        else if (line.match(/^<[^/!][^>]*>[^<]*<\/[^>]+>$/)) {
            result.push(indent.repeat(level) + line);
        }
        // DOCTYPE / comment
        else if (line.startsWith('<!')) {
            result.push(indent.repeat(level) + line);
        }
        // 开始标签 — 缩进后加层级
        else if (line.match(/^<[^/!?][^>]*[^/]>$/)) {
            result.push(indent.repeat(level) + line);
            level++;
        }
        // 其他
        else {
            result.push(indent.repeat(level) + line);
        }
    }

    return (xmlDecl ? xmlDecl + '\n' : '') + result.join('\n') + '\n';
}

/**
 * Parse XML string to XMLDocument
 */
export function parseXml(xmlString: string): XMLDocument {
    const parser = new DOMParser();
    return parser.parseFromString(xmlString, 'application/xml');
}

/**
 * Get the divisions value from the XML document
 */
export function getDivisions(xmlDoc: XMLDocument): number {
    const divisionsEl = xmlDoc.querySelector('attributes divisions');
    if (divisionsEl?.textContent) {
        return parseInt(divisionsEl.textContent, 10) || 1;
    }
    return 1;
}

// ============================================================================
// Pitch and Duration Helpers
// ============================================================================

/**
 * Parse a pitch string like "C4" or "C#5" into step, alter, and octave
 */
export function parsePitchString(pitchString: string): { step: string; alter: number; octave: number } {
    const match = pitchString.match(/^([A-Ga-g])([#b]*)(\d)$/);
    if (!match) {
        return { step: 'C', alter: 0, octave: 4 };
    }

    const step = match[1].toUpperCase();
    const accidentals = match[2];
    const octave = parseInt(match[3], 10);

    let alter = 0;
    if (accidentals) {
        for (const char of accidentals) {
            if (char === '#') alter += 1;
            if (char === 'b') alter -= 1;
        }
    }

    return { step, alter, octave };
}

/**
 * Get MusicXML duration value from duration type string
 */
export function getDurationValue(durationType: string, divisions: number = 1): number {
    const baseDuration = DURATION_MAP[durationType] ?? 1;
    return baseDuration * divisions;
}

/**
 * Get MusicXML <type> element value from duration type string
 */
export function getDurationTypeName(durationType: string): string {
    return DURATION_TYPE_MAP[durationType] ?? 'quarter';
}

// ============================================================================
// Entity Group Utilities
// ============================================================================

/**
 * 实体组类型定义
 * 每个实体组对应 UI 中的一个实体（单音符、和弦、休止符或空白）
 */
export type EntityGroup = {
    /** 实体类型 */
    type: 'note' | 'chord' | 'rest' | 'forward';
    /** 组内的 XML 元素（和弦可能有多个音符元素） */
    elements: Element[];
};

/**
 * 从小节中获取指定声部的所有实体组
 * 
 * 这个函数与 MusicXMLParser.parseMeasures 保持一致的逻辑：
 * - 遍历 note 和 forward 元素
 * - 按和弦关系分组
 * - 返回的索引与 UI 中的 entityIndex 一致
 * 
 * @param measureEl 小节元素
 * @param staffNumber 谱表编号 (1-based)
 * @param voiceNum 声部编号 (1-based, 或 staff 2 的 voice 需要加偏移)
 * @returns 实体组数组
 */
export function getEntityGroupsFromMeasure(
    measureEl: Element,
    staffNumber: number,
    voiceNum: number
): EntityGroup[] {
    const entityGroups: EntityGroup[] = [];
    let currentNoteGroup: Element[] = [];
    let currentGroupType: 'note' | 'chord' | 'rest' = 'note';

    const children = Array.from(measureEl.childNodes);

    for (const node of children) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;

        if (element.tagName === 'forward') {
            // forward 元素：检查 voice（forward 没有 staff，通过 voice 匹配）
            const voiceEl = element.querySelector('voice');
            const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

            if (voice === voiceNum) {
                // 先保存之前的音符组
                if (currentNoteGroup.length > 0) {
                    entityGroups.push({
                        type: currentNoteGroup.length > 1 ? 'chord' : currentGroupType,
                        elements: currentNoteGroup
                    });
                    currentNoteGroup = [];
                }
                // forward 单独作为一个实体组
                entityGroups.push({
                    type: 'forward',
                    elements: [element]
                });
            }
        } else if (element.tagName === 'note') {
            const staffEl = element.querySelector('staff');
            const voiceEl = element.querySelector('voice');
            const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
            const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

            if (staff === staffNumber && voice === voiceNum) {
                const isChordMember = element.querySelector('chord') !== null;
                const isRest = element.querySelector('rest') !== null;

                if (isChordMember && currentNoteGroup.length > 0) {
                    // chord 成员加入当前组
                    currentNoteGroup.push(element);
                } else {
                    // 新的主音符：先保存之前的组
                    if (currentNoteGroup.length > 0) {
                        entityGroups.push({
                            type: currentNoteGroup.length > 1 ? 'chord' : currentGroupType,
                            elements: currentNoteGroup
                        });
                    }
                    currentNoteGroup = [element];
                    currentGroupType = isRest ? 'rest' : 'note';
                }
            }
        }
    }

    // 保存最后一个组
    if (currentNoteGroup.length > 0) {
        entityGroups.push({
            type: currentNoteGroup.length > 1 ? 'chord' : currentGroupType,
            elements: currentNoteGroup
        });
    }

    return entityGroups;
}
