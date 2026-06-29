import type { ScoreData, ScoreEntity, Note, Chord, Rest, Blank, Measure, Stave, ConnectionData, NoteConnections, EntityInfo } from '@/types/score-types';
import { DEFAULT_TEMPO_BPM } from '../constants/audio';
import { extractPitch, isDottedDuration, parseArticulations, parseDuration } from './parser-values';

// A subset of melody-forge's parsing logic, adapted for modern TypeScript and our types.

const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

type NoteElementInfo = {
  entityId: string;
  pitch: string;
  measureNumber: number;
  staff: number;
  voice: number;
  xmlIndex: number;
};

/**
 * 解析器选项
 */
export type ParserOptions = {
  /**
   * 期望保留的声部结构
   * 格式: { measureIndex: { staveIndex: [voiceNumbers] } }
   * 解析完成后会确保这些声部存在（即使是空的）
   */
  expectedVoices?: Map<number, Map<number, number[]>>;
};

export class MusicXMLParser {
  private xmlDoc: XMLDocument;
  private divisions: number = 4;
  private entityIdCounter: number = 0;
  // 存储 noteElement 索引到 entityId 的映射
  private noteElementInfos: NoteElementInfo[] = [];
  // 连线数据
  private noteConnections: Map<string, NoteConnections> = new Map();
  // 解析器选项
  private options?: ParserOptions;

  constructor(xmlString: string, options?: ParserOptions) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");
    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new Error("Failed to parse XML string");
    }
    this.xmlDoc = doc;
    this.options = options;
  }

  private generateId(): string {
    return `entity_${++this.entityIdCounter}_${Date.now()}`;
  }

  private getStableElementId(element: Element): string {
    return (
      element.getAttributeNS(XML_NAMESPACE, 'id') ||
      element.getAttribute('xml:id') ||
      element.getAttribute('id') ||
      this.generateId()
    );
  }


  public parse(): ScoreData {
    this.divisions = this.getDivisions();
    const measures = this.parseMeasures();

    // 如果提供了 expectedVoices，确保这些声部存在（即使是空的）
    if (this.options?.expectedVoices) {
      this.ensureVoicesExist(measures, this.options.expectedVoices);
    }

    // 解析连线信息
    const connections = this.parseConnections(measures);

    const mainTitle =
      this.getElementText('work-title') ||
      this.getCreditTextByType('title');
    const subtitle =
      this.getCreditTextByType('subtitle');
    const copyright =
      this.getElementText('rights') ||
      this.getCreditTextByType('rights') ||
      this.getCreditTextByType('copyright');

    const composer =
      this.getCreatorByType('composer') ||
      this.getCreditTextByType('composer');
    const lyricist =
      this.getCreatorByType('lyricist') ||
      this.getCreditTextByType('lyricist');

    const keySignatureNode = this.xmlDoc.querySelector('key > fifths');
    const keySignature = keySignatureNode ? keySignatureNode.textContent || '0' : '0';

    const timeSignatureBeatsNode = this.xmlDoc.querySelector('time > beats');
    const timeSignatureBeatTypeNode = this.xmlDoc.querySelector('time > beat-type');
    const timeSignature = timeSignatureBeatsNode && timeSignatureBeatTypeNode
      ? `${timeSignatureBeatsNode.textContent}/${timeSignatureBeatTypeNode.textContent}`
      : '4/4';

    const tempoNode = this.xmlDoc.querySelector('sound[tempo]') || this.xmlDoc.querySelector('metronome per-minute');
    const tempo = tempoNode ? (tempoNode.getAttribute('tempo') || tempoNode.textContent || String(DEFAULT_TEMPO_BPM)) : String(DEFAULT_TEMPO_BPM);

    const noteCount = measures.reduce((acc, measure) =>
      measure.staves.reduce((staveAcc, stave) =>
        stave.voices.reduce((voiceAcc, voice) => {
          const count = voice.notes.reduce((entityAcc, entity) => {
            if (entity.type === 'chord') {
              return entityAcc + entity.pitches.length;
            }
            if (entity.type !== 'blank') {
              return entityAcc + 1;
            }
            return entityAcc;
          }, 0);
          return voiceAcc + count;
        }, staveAcc),
        acc),
      0);

    return {
      measures,
      mainTitle,
      subtitle,
      composer,
      lyricist,
      copyright,
      keySignature,
      timeSignature,
      tempo,
      measureCount: measures.length,
      noteCount,
      connections,
    };
  }

  /**
   * 确保期望的声部存在于解析结果中（即使是空的）
   * 这解决了空声部在重新解析后丢失的问题
   */
  private ensureVoicesExist(
    measures: Measure[],
    expectedVoices: Map<number, Map<number, number[]>>
  ): void {
    expectedVoices.forEach((staveVoices, measureIndex) => {
      const measure = measures[measureIndex];
      if (!measure) return;

      staveVoices.forEach((voiceNumbers, staveIndex) => {
        const stave = measure.staves[staveIndex];
        if (!stave) return;

        voiceNumbers.forEach(voiceNum => {
          const voiceName = `voiceLabel ${voiceNum}`;
          const exists = stave.voices.some(v => v.name === voiceName);
          if (!exists) {
            // 空声部丢失了，恢复它
            stave.voices.push({ name: voiceName, notes: [] });
          }
        });

        // 保持排序一致
        stave.voices.sort((a, b) => a.name.localeCompare(b.name));
      });
    });
  }

  /**
   * 从 <identification> 中获取指定类型的 <creator> 元素文本
   */
  private getCreatorByType(type: string): string {
    const creators = this.xmlDoc.querySelectorAll('identification > creator');
    for (const creator of creators) {
      if (creator.getAttribute('type') === type) {
        return creator.textContent?.trim() || '';
      }
    }
    return '';
  }

  private getElementText(selector: string): string {
    return this.xmlDoc.querySelector(selector)?.textContent?.trim() || '';
  }

  /**
   * 从 <credit> 中获取指定 credit-type 的 <credit-words> 文本
   */
  private getCreditTextByType(type: string): string {
    const credits = this.xmlDoc.querySelectorAll('credit');
    for (const credit of credits) {
      const creditType = credit.querySelector('credit-type');
      if (creditType?.textContent?.trim().toLowerCase() === type.toLowerCase()) {
        return this.getCreditWordsText(credit);
      }
    }
    return '';
  }

  private getCreditWordsText(credit: Element): string {
    return Array.from(credit.querySelectorAll('credit-words'))
      .map(node => node.textContent?.trim() || '')
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private getDivisions(): number {
    const divisionsNode = this.xmlDoc.querySelector('divisions');
    return divisionsNode ? parseInt(divisionsNode.textContent || '4', 10) : 4;
  }

  private parseMeasures(): Measure[] {
    const measureNodes = this.xmlDoc.querySelectorAll('part > measure');
    const measures: Measure[] = [];

    measureNodes.forEach((measureNode, measureIndex) => {
      const measureNumber = parseInt(measureNode.getAttribute('number') || '0', 10);

      const staves: Record<string, Stave> = {
        '1': { clef: 'treble', name: 'trebleClef', voices: [] },
        '2': { clef: 'bass', name: 'bassClef', voices: [] },
      };

      const voiceEntities: Record<string, ScoreEntity[]> = {};

      // 时间游标追踪（voiceKey -> currentTick）
      const voiceCursors: Map<string, number> = new Map();
      const getVoiceCursor = (key: string): number => voiceCursors.get(key) ?? 0;
      const setVoiceCursor = (key: string, tick: number) => voiceCursors.set(key, Math.max(0, tick));

      // 按文档顺序遍历所有子元素 (note, forward, backup)
      const children = Array.from(measureNode.childNodes);
      for (const node of children) {
        if (node.nodeType !== 1) continue; // 跳过非元素节点
        const element = node as Element;

        if (element.tagName === 'backup') {
          // backup 回退时间游标（影响后续音符的声部）
          const backupDuration = parseInt(element.querySelector('duration')?.textContent || '0', 10);
          // backup 通常影响所有活跃的声部，这里简化处理：回退所有已存在的游标
          voiceCursors.forEach((currentTick, key) => {
            setVoiceCursor(key, currentTick - backupDuration);
          });
        } else if (element.tagName === 'note') {
          const noteNode = element;
          const staffEl = noteNode.querySelector('staff');
          const staffIndex = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;

          const voiceEl = noteNode.querySelector('voice');
          const voiceIndex = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

          const voiceKey = `${staffIndex}-${voiceIndex}`;
          if (!voiceEntities[voiceKey]) {
            voiceEntities[voiceKey] = [];
          }

          // 获取当前时间位置
          const currentTick = getVoiceCursor(voiceKey);

          // 获取音符时值
          const isGrace = noteNode.querySelector('grace') !== null;
          const noteDuration = isGrace ? 0 : parseInt(noteNode.querySelector('duration')?.textContent || '0', 10);

          // 解析 dotted
          const hasDot = noteNode.querySelector('dot') !== null;

          if (noteNode.querySelector('chord')) {
            const noteId = this.getStableElementId(noteNode);
            // It's part of a chord, find the last entity and add to it if it is a chord
            // 和弦成员不推进时间游标，使用前一个音符的 startTick
            const lastEntity = voiceEntities[voiceKey][voiceEntities[voiceKey].length - 1];

            // 解析当前音符的指法
            const fingeringEl = noteNode.querySelector('notations > technical > fingering');
            const currentFingering = fingeringEl?.textContent?.trim();

            if (lastEntity && lastEntity.type === 'chord') {
              const pitch = extractPitch(noteNode);
              if (pitch) {
                lastEntity.pitches.push(pitch);
                // 添加指法到 fingerings 数组，确保数组存在
                if (!lastEntity.fingerings) {
                  // 如果 fingerings 不存在，初始化为与现有 pitches 长度匹配的数组
                  lastEntity.fingerings = lastEntity.pitches.slice(0, -1).map(() => 'none');
                }
                lastEntity.fingerings.push(currentFingering || 'none');
                if (lastEntity.meta) {
                  lastEntity.meta.sourceIds = [...(lastEntity.meta.sourceIds || [lastEntity.meta.id]), noteId];
                }
              }
            } else if (lastEntity && lastEntity.type === 'note') {
              const firstNoteId = lastEntity.meta?.id;
              // Convert previous note to a chord, preserve meta from original note
              const newChord: Chord = {
                type: 'chord',
                pitches: [lastEntity.pitch, extractPitch(noteNode)].filter(p => p) as string[],
                duration: lastEntity.duration,
                dotted: lastEntity.dotted || hasDot,
                stemDirection: lastEntity.stemDirection,
                fingerings: [lastEntity.fingering || 'none', currentFingering || 'none'],
                articulation: lastEntity.articulation,
                meta: lastEntity.meta
                  ? { ...lastEntity.meta, sourceIds: [firstNoteId, noteId].filter(Boolean) as string[] }
                  : undefined, // 保留原音符的 meta（包含 startTick）
              };
              voiceEntities[voiceKey][voiceEntities[voiceKey].length - 1] = newChord;
            }
          } else if (noteNode.querySelector('rest')) {
            const entityIndex = voiceEntities[voiceKey].length;
            const rest: Rest = {
              type: 'rest',
              duration: parseDuration(noteNode, this.divisions),
              dotted: hasDot,
              meta: {
                id: this.getStableElementId(noteNode),
                sourceIds: [this.getStableElementId(noteNode)],
                measureIndex,
                staveIndex: staffIndex - 1,
                xmlVoice: voiceIndex,
                entityIndex,
                startTick: currentTick,
              },
            };
            voiceEntities[voiceKey].push(rest);
            // 推进时间游标
            setVoiceCursor(voiceKey, currentTick + noteDuration);
          } else {
            const pitch = extractPitch(noteNode);
            if (pitch) {
              const entityIndex = voiceEntities[voiceKey].length;

              // 解析符干方向
              const stemEl = noteNode.querySelector('stem');
              const stemText = stemEl?.textContent?.trim().toLowerCase();
              let stemDirection: 'up' | 'down' | 'none' | undefined;
              if (stemText === 'up' || stemText === 'down' || stemText === 'none') {
                stemDirection = stemText;
              }

              // 解析指法
              const fingeringEl = noteNode.querySelector('notations > technical > fingering');
              const fingering = fingeringEl?.textContent?.trim();

              const note: Note = {
                type: 'note',
                pitch: pitch,
                duration: parseDuration(noteNode, this.divisions),
                dotted: hasDot,
                stemDirection: stemDirection,
                fingering: fingering,
                articulation: parseArticulations(noteNode),
                meta: {
                  id: this.getStableElementId(noteNode),
                  sourceIds: [this.getStableElementId(noteNode)],
                  measureIndex,
                  staveIndex: staffIndex - 1,
                  xmlVoice: voiceIndex,
                  entityIndex,
                  startTick: currentTick,
                },
              };
              voiceEntities[voiceKey].push(note);
              // 推进时间游标
              setVoiceCursor(voiceKey, currentTick + noteDuration);
            }
          }
        } else if (element.tagName === 'forward') {
          // 处理 forward (空白)
          const forwardNode = element;
          const staffEl = forwardNode.querySelector('staff');
          const staffIndex = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
          const voiceEl = forwardNode.querySelector('voice');
          const voiceIndex = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
          const voiceKey = `${staffIndex}-${voiceIndex}`;
          if (!voiceEntities[voiceKey]) {
            voiceEntities[voiceKey] = [];
          }
          const entityIndex = voiceEntities[voiceKey].length;

          // 获取当前时间位置
          const currentTick = getVoiceCursor(voiceKey);

          // 基于 duration ratio 推断 dotted
          const forwardDuration = parseInt(forwardNode.querySelector('duration')?.textContent || '4', 10);
          const isDotted = isDottedDuration(forwardDuration, this.divisions);

          const blank: Blank = {
            type: 'blank',
            duration: parseDuration(forwardNode, this.divisions),
            dotted: isDotted,
            meta: {
              id: this.getStableElementId(forwardNode),
              sourceIds: [this.getStableElementId(forwardNode)],
              measureIndex,
              staveIndex: staffIndex - 1,
              xmlVoice: voiceIndex,
              entityIndex,
              startTick: currentTick,
            },
          };
          voiceEntities[voiceKey].push(blank);
          // forward 推进时间游标
          setVoiceCursor(voiceKey, currentTick + forwardDuration);
        }
      }

      // Assemble staves and voices - 按声部编号排序
      const sortedVoiceKeys = Object.keys(voiceEntities).sort((a, b) => {
        const [staffA, voiceA] = a.split('-').map(Number);
        const [staffB, voiceB] = b.split('-').map(Number);
        if (staffA !== staffB) return staffA - staffB;
        return voiceA - voiceB;
      });

      for (const voiceKey of sortedVoiceKeys) {
        const [staffIndexStr, voiceIndexStr] = voiceKey.split('-');
        const staffIndex = parseInt(staffIndexStr, 10);
        const voiceIndex = parseInt(voiceIndexStr, 10);

        const stave = staves[staffIndex];

        let voice = stave.voices.find(v => v.name === `voiceLabel ${voiceIndex}`);
        if (!voice) {
          voice = { name: `voiceLabel ${voiceIndex}`, notes: [] };
          stave.voices.push(voice);
        }
        voice.notes.push(...voiceEntities[voiceKey]);
      }

      measures.push({
        number: measureNumber,
        // 保留所有预定义的 stave，即使没有 voice（空声部也需要显示）
        staves: Object.values(staves)
      });
    });

    return measures;
  }

  /**
   * 解析连线信息 (tie, slur, beam)
   * 基于已解析的 measures 构建 entityId 映射，然后解析 XML 中的连线元素
   */
  private parseConnections(measures: Measure[]): ConnectionData {
    const noteConnections = new Map<string, NoteConnections>();
    const entityInfoMap = new Map<string, EntityInfo>();

    // 构建 entityId 查找表: 通过 measureIndex/staveIndex/voiceIndex/entityIndex 查找 entityId
    const entityIdMap = new Map<string, string>();
    const entityPitchMap = new Map<string, string[]>(); // entityId -> pitches (for chords)

    measures.forEach((measure, measureIndex) => {
      measure.staves.forEach((stave, _staveIndex) => {
        stave.voices.forEach((voice, voiceIndex) => {
          // 从 voice.name 中提取实际的声部编号 (格式: "voiceLabel X")
          const voiceNumberMatch = voice.name.match(/voiceLabel\s*(\d+)/);
          const actualVoiceNumber = voiceNumberMatch ? parseInt(voiceNumberMatch[1], 10) : voiceIndex + 1;

          voice.notes.forEach((entity, entityIndex) => {
            if (entity.meta?.id) {
              // 使用 entity.meta 中存储的原始索引\n              // xmlVoice 是 1-based，key 格式保持兼容（使用 xmlVoice - 1）
              const key = `${measureIndex}-${entity.meta.staveIndex}-${entity.meta.xmlVoice - 1}-${entityIndex}`;
              entityIdMap.set(key, entity.meta.id);

              // 记录音高用于连线匹配
              if (entity.type === 'note') {
                entityPitchMap.set(entity.meta.id, [entity.pitch]);
                // 构建 entityInfo
                entityInfoMap.set(entity.meta.id, {
                  pitch: entity.pitch,
                  measureNumber: measure.number,
                  staveLabel: stave.name,
                  voiceNumber: actualVoiceNumber,
                  position: entityIndex + 1,
                });
              } else if (entity.type === 'chord') {
                entityPitchMap.set(entity.meta.id, entity.pitches);
                // 构建 entityInfo (和弦显示所有音高)
                entityInfoMap.set(entity.meta.id, {
                  pitch: entity.pitches.join('+'),
                  measureNumber: measure.number,
                  staveLabel: stave.name,
                  voiceNumber: actualVoiceNumber,
                  position: entityIndex + 1,
                });
              } else if (entity.type === 'rest') {
                entityInfoMap.set(entity.meta.id, {
                  pitch: 'rest',
                  measureNumber: measure.number,
                  staveLabel: stave.name,
                  voiceNumber: actualVoiceNumber,
                  position: entityIndex + 1,
                });
              } else if (entity.type === 'blank') {
                entityInfoMap.set(entity.meta.id, {
                  pitch: 'blank',
                  measureNumber: measure.number,
                  staveLabel: stave.name,
                  voiceNumber: actualVoiceNumber,
                  position: entityIndex + 1,
                });
              }
            }
          });
        });
      });
    });

    // 构建 entityId -> startTick 映射（用于按时间顺序配对）
    const entityStartTickMap = new Map<string, number>();
    measures.forEach((measure, measureIndex) => {
      measure.staves.forEach((stave) => {
        stave.voices.forEach((voice) => {
          voice.notes.forEach((entity) => {
            if (entity.meta?.id) {
              // 计算全局时间位置：measureIndex * 大数 + startTick
              const globalTick = measureIndex * 1000000 + (entity.meta.startTick ?? 0);
              entityStartTickMap.set(entity.meta.id, globalTick);
            }
          });
        });
      });
    });

    // 辅助函数：确保 noteConnections 中有该 entityId 的条目
    const ensureConnection = (entityId: string): NoteConnections => {
      if (!noteConnections.has(entityId)) {
        noteConnections.set(entityId, { ties: [], slurs: [], beams: [] });
      }
      return noteConnections.get(entityId)!;
    };

    // 解析 Tie (连音线) - 使用双遍历策略按时间顺序配对（符合 MusicXML 规范）
    // 第一遍：收集所有 tie start/stop 事件
    type TieEvent = {
      type: 'start' | 'stop';
      entityId: string;
      pitch: string;
      staff: number;
      voice: number;
      globalTick: number;
    };
    const tieEvents: TieEvent[] = [];

    this.xmlDoc.querySelectorAll('part > measure').forEach((measureNode, measureIndex) => {
      const entityCounters: Record<string, number> = {};
      const lastEntityId: Record<string, string> = {};

      const children = Array.from(measureNode.childNodes);
      for (const node of children) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;

        if (element.tagName === 'forward') {
          const staffEl = element.querySelector('staff');
          const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
          const voiceEl = element.querySelector('voice');
          const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
          const voiceKey = `${staff - 1}-${voice - 1}`;
          if (!entityCounters[voiceKey]) entityCounters[voiceKey] = 0;
          const key = `${measureIndex}-${staff - 1}-${voice - 1}-${entityCounters[voiceKey]}`;
          const entityId = entityIdMap.get(key);
          if (entityId) lastEntityId[voiceKey] = entityId;
          entityCounters[voiceKey]++;
        } else if (element.tagName === 'note') {
          const noteNode = element;
          const staffEl = noteNode.querySelector('staff');
          const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
          const voiceEl = noteNode.querySelector('voice');
          const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

          const isChordPart = noteNode.querySelector('chord') !== null;
          const isRest = noteNode.querySelector('rest') !== null;

          const voiceKey = `${staff - 1}-${voice - 1}`;
          if (!entityCounters[voiceKey]) entityCounters[voiceKey] = 0;

          let currentEntityId: string | undefined;

          if (!isChordPart) {
            const key = `${measureIndex}-${staff - 1}-${voice - 1}-${entityCounters[voiceKey]}`;
            currentEntityId = entityIdMap.get(key);
            if (currentEntityId) lastEntityId[voiceKey] = currentEntityId;
            entityCounters[voiceKey]++;
          } else {
            currentEntityId = lastEntityId[voiceKey];
          }

          // 收集 tie 事件
          if (currentEntityId && !isRest) {
            const pitch = extractPitch(noteNode) || '';

            noteNode.querySelectorAll('tie').forEach((tieNode) => {
              const type = tieNode.getAttribute('type') as 'start' | 'stop';
              if (type === 'start' || type === 'stop') {
                const globalTick = entityStartTickMap.get(currentEntityId!) ?? 0;
                tieEvents.push({ type, entityId: currentEntityId!, pitch, staff, voice, globalTick });
              }
            });
          }
        }
      }
    });

    // 第二遍：按 globalTick 排序后配对
    tieEvents.sort((a, b) => a.globalTick - b.globalTick);

    const tieStarts: Map<string, { entityId: string; pitch: string }> = new Map();
    for (const event of tieEvents) {
      const tieKey = `${event.pitch}-${event.staff}-${event.voice}`;

      if (event.type === 'start') {
        tieStarts.set(tieKey, { entityId: event.entityId, pitch: event.pitch });
      } else if (event.type === 'stop') {
        const startInfo = tieStarts.get(tieKey);
        if (startInfo && startInfo.entityId !== event.entityId) {
          const startConn = ensureConnection(startInfo.entityId);
          const stopConn = ensureConnection(event.entityId);

          const startHas = startConn.ties.some(t => t.partnerId === event.entityId);
          const stopHas = stopConn.ties.some(t => t.partnerId === startInfo.entityId);

          if (!startHas) {
            startConn.ties.push({ partnerId: event.entityId, type: 'start' });
          }
          if (!stopHas) {
            stopConn.ties.push({ partnerId: startInfo.entityId, type: 'stop' });
          }

          tieStarts.delete(tieKey);
        }
      }
    }

    // 解析 Slur (连奏线) - 使用双遍历策略按时间顺序配对（符合 MusicXML 规范）
    // 第一遍：收集所有 slur start/stop 事件
    type SlurEvent = {
      type: 'start' | 'stop';
      entityId: string;
      staff: number;
      number: number;
      globalTick: number;
    };
    const slurEvents: SlurEvent[] = [];
    let slurIdCounter = 0;

    this.xmlDoc.querySelectorAll('part > measure').forEach((measureNode, measureIndex) => {
      const entityCounters: Record<string, number> = {};
      const lastEntityId: Record<string, string> = {};

      const children = Array.from(measureNode.childNodes);
      for (const node of children) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;

        if (element.tagName === 'forward') {
          const staffEl = element.querySelector('staff');
          const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
          const voiceEl = element.querySelector('voice');
          const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
          const voiceKey = `${staff - 1}-${voice - 1}`;
          if (!entityCounters[voiceKey]) entityCounters[voiceKey] = 0;
          const key = `${measureIndex}-${staff - 1}-${voice - 1}-${entityCounters[voiceKey]}`;
          const entityId = entityIdMap.get(key);
          if (entityId) lastEntityId[voiceKey] = entityId;
          entityCounters[voiceKey]++;
        } else if (element.tagName === 'note') {
          const noteNode = element;
          const staffEl = noteNode.querySelector('staff');
          const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
          const voiceEl = noteNode.querySelector('voice');
          const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

          const isChordPart = noteNode.querySelector('chord') !== null;
          const isRest = noteNode.querySelector('rest') !== null;

          const voiceKey = `${staff - 1}-${voice - 1}`;
          if (!entityCounters[voiceKey]) entityCounters[voiceKey] = 0;

          let currentEntityId: string | undefined;

          if (!isChordPart) {
            const key = `${measureIndex}-${staff - 1}-${voice - 1}-${entityCounters[voiceKey]}`;
            currentEntityId = entityIdMap.get(key);
            if (currentEntityId) lastEntityId[voiceKey] = currentEntityId;
            entityCounters[voiceKey]++;
          } else {
            currentEntityId = lastEntityId[voiceKey];
          }

          // 收集 slur 事件
          if (currentEntityId && !isRest) {
            noteNode.querySelectorAll('notations > slur').forEach((slurNode) => {
              const type = slurNode.getAttribute('type') as 'start' | 'stop' | 'continue';
              const number = parseInt(slurNode.getAttribute('number') || '1', 10);
              if (type === 'start' || type === 'stop') {
                const globalTick = entityStartTickMap.get(currentEntityId!) ?? 0;
                slurEvents.push({ type, entityId: currentEntityId!, staff, number, globalTick });
              }
            });
          }
        }
      }
    });

    // 第二遍：按 globalTick 排序后配对
    slurEvents.sort((a, b) => a.globalTick - b.globalTick);

    const slurStarts: Map<string, { entityId: string; number: number }> = new Map();
    for (const event of slurEvents) {
      const slurKey = `${event.staff}-${event.number}`;

      if (event.type === 'start') {
        slurStarts.set(slurKey, { entityId: event.entityId, number: event.number });
      } else if (event.type === 'stop') {
        const startInfo = slurStarts.get(slurKey);
        if (startInfo && startInfo.entityId !== event.entityId) {
          const slurId = `slur_${++slurIdCounter}`;
          const partnerIds = [startInfo.entityId, event.entityId];

          const startConn = ensureConnection(startInfo.entityId);
          const stopConn = ensureConnection(event.entityId);

          const startHas = startConn.slurs.some(s => s.partnerIds[0] === startInfo.entityId && s.partnerIds[1] === event.entityId);
          const stopHas = stopConn.slurs.some(s => s.partnerIds[0] === startInfo.entityId && s.partnerIds[1] === event.entityId);

          if (!startHas) {
            startConn.slurs.push({ slurId, type: 'start', partnerIds });
          }
          if (!stopHas) {
            stopConn.slurs.push({ slurId, type: 'stop', partnerIds });
          }

          slurStarts.delete(slurKey);
        }
      }
    }

    // 解析 Beam (连音符) - 使用双遍历策略按时间顺序配对（符合 MusicXML 规范）
    // 第一遍：收集所有 beam 事件
    type BeamEvent = {
      type: 'begin' | 'continue' | 'end';
      entityId: string;
      measureIndex: number;
      staff: number;
      voice: number;
      globalTick: number;
    };
    const beamEvents: BeamEvent[] = [];
    let beamIdCounter = 0;

    this.xmlDoc.querySelectorAll('part > measure').forEach((measureNode, measureIndex) => {
      const entityCounters: Record<string, number> = {};

      const children = Array.from(measureNode.childNodes);
      for (const node of children) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;

        if (element.tagName === 'forward') {
          const staffEl = element.querySelector('staff');
          const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
          const voiceEl = element.querySelector('voice');
          const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;
          const voiceKey = `${staff - 1}-${voice - 1}`;
          if (!entityCounters[voiceKey]) entityCounters[voiceKey] = 0;
          entityCounters[voiceKey]++;
        } else if (element.tagName === 'note') {
          const noteNode = element;
          const staffEl = noteNode.querySelector('staff');
          const staff = staffEl ? parseInt(staffEl.textContent || '1', 10) : 1;
          const voiceEl = noteNode.querySelector('voice');
          const voice = voiceEl ? parseInt(voiceEl.textContent || '1', 10) : 1;

          const isChordPart = noteNode.querySelector('chord') !== null;
          const isRest = noteNode.querySelector('rest') !== null;

          const voiceKey = `${staff - 1}-${voice - 1}`;
          if (!entityCounters[voiceKey]) entityCounters[voiceKey] = 0;

          if (!isChordPart) {
            const key = `${measureIndex}-${staff - 1}-${voice - 1}-${entityCounters[voiceKey]}`;
            const entityId = entityIdMap.get(key);

            if (entityId && !isRest) {
              const beamNode = noteNode.querySelector('beam[number="1"]');
              if (beamNode) {
                const beamType = beamNode.textContent?.trim() as 'begin' | 'continue' | 'end';
                if (beamType === 'begin' || beamType === 'continue' || beamType === 'end') {
                  const globalTick = entityStartTickMap.get(entityId) ?? 0;
                  beamEvents.push({ type: beamType, entityId, measureIndex, staff, voice, globalTick });
                }
              }
            }

            entityCounters[voiceKey]++;
          }
        }
      }
    });

    // 第二遍：按 globalTick 排序后配对
    beamEvents.sort((a, b) => a.globalTick - b.globalTick);

    const beamGroups: Map<string, string[]> = new Map();
    for (const event of beamEvents) {
      const beamKey = `${event.measureIndex}-${event.staff}-${event.voice}`;

      if (event.type === 'begin') {
        beamGroups.set(beamKey, [event.entityId]);
      } else if (event.type === 'continue' || event.type === 'end') {
        const group = beamGroups.get(beamKey);
        if (group && !group.includes(event.entityId)) {
          group.push(event.entityId);
        }

        if (event.type === 'end' && group && group.length >= 2) {
          const beamId = `beam_${++beamIdCounter}`;
          group.forEach(id => {
            const conn = ensureConnection(id);
            conn.beams.push({ beamId, noteIds: [...group] });
          });
          beamGroups.delete(beamKey);
        }
      }
    }

    return { noteConnections, entityInfoMap };
  }
}
