import type { AccidentalValue, ScoreData, ScoreEntity, Note, Chord, Rest, Blank, Measure, Stave, ConnectionData, NoteConnections, EntityInfo } from '@/types/score-types';
import { DEFAULT_TEMPO_BPM } from '../constants/audio';
import { extractPitch, isDottedDuration, parseArticulations, parseDuration } from './parser-values';

// A subset of melody-forge's parsing logic, adapted for modern TypeScript and our types.

type NoteElementInfo = {
  entityId: string;
  pitch: string;
  measureNumber: number;
  staff: number;
  voice: number;
  xmlIndex: number;
};

const FINGERING_TEXT_MAP: Record<string, string> = {
  '\u2460': '1',
  '\u2461': '2',
  '\u2462': '3',
  '\u2463': '4',
  '\u2464': '5',
};

function normalizeFingeringText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const mapped = FINGERING_TEXT_MAP[normalized] ?? normalized;
  return /^[1-5]$/.test(mapped) ? mapped : undefined;
}

function parseAccidental(note: Element): AccidentalValue | undefined {
  const value = note.querySelector(':scope > accidental')?.textContent?.trim();
  return value === 'flat-flat' || value === 'flat' || value === 'natural' || value === 'sharp'
    ? value
    : undefined;
}

/**
 * Parser options.
 */
export type ParserOptions = {
  /**
   * Voice structure that must be preserved in the parsed score.
   *
   * Shape: `{ measureIndex: { staveIndex: [voiceNumbers] } }`.
   * Parsing ensures these voices exist even when they contain no entities.
   */
  expectedVoices?: Map<number, Map<number, number[]>>;
};

export class MusicXMLParser {
  private xmlDoc: XMLDocument;
  private divisions: number = 4;
  private entityIdCounter: number = 0;
  // Note-element metadata used for connection reconstruction.
  private noteElementInfos: NoteElementInfo[] = [];
  // Parsed tie, slur, and beam connection data.
  private noteConnections: Map<string, NoteConnections> = new Map();
  // Parser options supplied by the caller.
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
      element.getAttribute('id') ||
      this.generateId()
    );
  }


  public parse(): ScoreData {
    this.divisions = this.getDivisions();
    const measures = this.parseMeasures();

    // Preserve caller-provided empty voices after parsing.
    if (this.options?.expectedVoices) {
      this.ensureVoicesExist(measures, this.options.expectedVoices);
    }

    // Parse tie, slur, and beam connection metadata.
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
   * Ensures expected voices exist in the parsed result, even when empty.
   *
   * This prevents empty voices from disappearing after reparsing edited XML.
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
            // Restore an expected empty voice that was absent from parsed XML.
            stave.voices.push({ name: voiceName, notes: [] });
          }
        });

        // Keep voice order stable for editor rendering.
        stave.voices.sort((a, b) => a.name.localeCompare(b.name));
      });
    });
  }

  /**
   * Returns the text for a typed `<creator>` under `<identification>`.
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
   * Returns `<credit-words>` text for a matching `credit-type`.
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

      // Track timeline cursors by voice key.
      const voiceCursors: Map<string, number> = new Map();
      const getVoiceCursor = (key: string): number => voiceCursors.get(key) ?? 0;
      const setVoiceCursor = (key: string, tick: number) => voiceCursors.set(key, Math.max(0, tick));

      // Walk note, forward, and backup elements in document order.
      const children = Array.from(measureNode.childNodes);
      for (const node of children) {
        if (node.nodeType !== 1) continue;
        const element = node as Element;

        if (element.tagName === 'backup') {
          // Backup rewinds timeline cursors for subsequent voice events.
          const backupDuration = parseInt(element.querySelector('duration')?.textContent || '0', 10);
          // A backup usually applies across active voices; rewind every known cursor.
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

          // Resolve the current timeline position.
          const currentTick = getVoiceCursor(voiceKey);

          // Resolve rhythmic duration.
          const isGrace = noteNode.querySelector('grace') !== null;
          const noteDuration = isGrace ? 0 : parseInt(noteNode.querySelector('duration')?.textContent || '0', 10);

          // Parse dotted state.
          const hasDot = noteNode.querySelector('dot') !== null;

          if (noteNode.querySelector('chord')) {
            const noteId = this.getStableElementId(noteNode);
            // It's part of a chord, find the last entity and add to it if it is a chord
            // Chord members do not advance the cursor; they share the root note start tick.
            const lastEntity = voiceEntities[voiceKey][voiceEntities[voiceKey].length - 1];

            // Parse fingering for this chord member.
            const fingeringEl = noteNode.querySelector('notations > technical > fingering');
            const currentFingering = normalizeFingeringText(fingeringEl?.textContent);

            if (lastEntity && lastEntity.type === 'chord') {
              const pitch = extractPitch(noteNode);
              if (pitch) {
                lastEntity.pitches.push(pitch);
                // Append fingering while preserving an index-aligned array.
                if (!lastEntity.fingerings) {
                  // Backfill existing chord pitches when the array is absent.
                  lastEntity.fingerings = lastEntity.pitches.slice(0, -1).map(() => 'none');
                }
                lastEntity.fingerings.push(currentFingering || 'none');
                if (!lastEntity.accidentals) lastEntity.accidentals = lastEntity.pitches.slice(0, -1).map(() => undefined);
                lastEntity.accidentals.push(parseAccidental(noteNode));
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
                accidentals: [lastEntity.accidental, parseAccidental(noteNode)],
                articulation: lastEntity.articulation,
                meta: lastEntity.meta
                  ? { ...lastEntity.meta, sourceIds: [firstNoteId, noteId].filter(Boolean) as string[] }
                  : undefined, // Preserve original note metadata, including startTick.
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
            // Advance the timeline cursor.
            setVoiceCursor(voiceKey, currentTick + noteDuration);
          } else {
            const pitch = extractPitch(noteNode);
            if (pitch) {
              const entityIndex = voiceEntities[voiceKey].length;

              // Parse stem direction.
              const stemEl = noteNode.querySelector('stem');
              const stemText = stemEl?.textContent?.trim().toLowerCase();
              let stemDirection: 'up' | 'down' | 'none' | undefined;
              if (stemText === 'up' || stemText === 'down' || stemText === 'none') {
                stemDirection = stemText;
              }

              // Parse fingering.
              const fingeringEl = noteNode.querySelector('notations > technical > fingering');
              const fingering = normalizeFingeringText(fingeringEl?.textContent);

              const note: Note = {
                type: 'note',
                pitch: pitch,
                duration: parseDuration(noteNode, this.divisions),
                dotted: hasDot,
                stemDirection: stemDirection,
                fingering: fingering,
                accidental: parseAccidental(noteNode),
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
              // Advance the timeline cursor.
              setVoiceCursor(voiceKey, currentTick + noteDuration);
            }
          }
        } else if (element.tagName === 'forward') {
          // Convert MusicXML forward elements to blank UI entities.
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

          // Resolve the current timeline position.
          const currentTick = getVoiceCursor(voiceKey);

          // Infer dotted state from the duration ratio.
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
          // Forward advances the timeline cursor.
          setVoiceCursor(voiceKey, currentTick + forwardDuration);
        }
      }

      // Assemble staves and voices in staff/voice order.
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
        // Keep predefined staves even when they have no voices.
        staves: Object.values(staves)
      });
    });

    return measures;
  }

  /**
   * Parses tie, slur, and beam connection metadata.
   * Builds entity lookup maps from parsed measures, then scans XML connection elements.
   */
  private parseConnections(measures: Measure[]): ConnectionData {
    const noteConnections = new Map<string, NoteConnections>();
    const entityInfoMap = new Map<string, EntityInfo>();

    // Build an entity lookup table by measure/staff/voice/entity indexes.
    const entityIdMap = new Map<string, string>();
    const entityPitchMap = new Map<string, string[]>(); // entityId -> pitches (for chords)

    measures.forEach((measure, measureIndex) => {
      measure.staves.forEach((stave, _staveIndex) => {
        stave.voices.forEach((voice, voiceIndex) => {
          // Extract the actual voice number from names like "voiceLabel X".
          const voiceNumberMatch = voice.name.match(/voiceLabel\s*(\d+)/);
          const actualVoiceNumber = voiceNumberMatch ? parseInt(voiceNumberMatch[1], 10) : voiceIndex + 1;

          voice.notes.forEach((entity, entityIndex) => {
            if (entity.meta?.id) {
              // xmlVoice uses MusicXML 1-based numbering; entityIdMap keys use zero-based voice indexes.
              const key = `${measureIndex}-${entity.meta.staveIndex}-${entity.meta.xmlVoice - 1}-${entityIndex}`;
              entityIdMap.set(key, entity.meta.id);

              // Store pitch data for connection matching.
              if (entity.type === 'note') {
                entityPitchMap.set(entity.meta.id, [entity.pitch]);
                // Build display metadata for a note entity.
                entityInfoMap.set(entity.meta.id, {
                  pitch: entity.pitch,
                  measureNumber: measure.number,
                  staveLabel: stave.name,
                  voiceNumber: actualVoiceNumber,
                  position: entityIndex + 1,
                });
              } else if (entity.type === 'chord') {
                entityPitchMap.set(entity.meta.id, entity.pitches);
                // Build display metadata for a chord entity, showing all pitches.
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

    // Map entity ids to global start ticks for chronological pairing.
    const entityStartTickMap = new Map<string, number>();
    measures.forEach((measure, measureIndex) => {
      measure.staves.forEach((stave) => {
        stave.voices.forEach((voice) => {
          voice.notes.forEach((entity) => {
            if (entity.meta?.id) {
              // Use a large per-measure offset so measure order dominates startTick.
              const globalTick = measureIndex * 1000000 + (entity.meta.startTick ?? 0);
              entityStartTickMap.set(entity.meta.id, globalTick);
            }
          });
        });
      });
    });

    // Ensure a noteConnections entry exists for the given entity id.
    const ensureConnection = (entityId: string): NoteConnections => {
      if (!noteConnections.has(entityId)) {
        noteConnections.set(entityId, { ties: [], slurs: [], beams: [] });
      }
      return noteConnections.get(entityId)!;
    };

    // Parse ties in two passes so start/stop events pair in MusicXML timeline order.
    // First pass: collect every tie start/stop event.
    type TieEvent = {
      type: 'start' | 'stop';
      entityId: string;
      sourceId: string;
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

          // Collect tie events for non-rest note entities.
          if (currentEntityId && !isRest) {
            const pitch = extractPitch(noteNode) || '';
            const sourceId = this.getStableElementId(noteNode);

            noteNode.querySelectorAll('tie').forEach((tieNode) => {
              const type = tieNode.getAttribute('type') as 'start' | 'stop';
              if (type === 'start' || type === 'stop') {
                const globalTick = entityStartTickMap.get(currentEntityId!) ?? 0;
                tieEvents.push({ type, entityId: currentEntityId!, sourceId, pitch, staff, voice, globalTick });
              }
            });
          }
        }
      }
    });

    // Second pass: sort by global tick and pair matching events.
    tieEvents.sort((a, b) => a.globalTick - b.globalTick);

    const tieStarts: Map<string, { entityId: string; sourceId: string; pitch: string }> = new Map();
    for (const event of tieEvents) {
      const tieKey = `${event.pitch}-${event.staff}-${event.voice}`;

      if (event.type === 'start') {
        tieStarts.set(tieKey, { entityId: event.entityId, sourceId: event.sourceId, pitch: event.pitch });
      } else if (event.type === 'stop') {
        const startInfo = tieStarts.get(tieKey);
        if (startInfo && startInfo.entityId !== event.entityId) {
          const startConn = ensureConnection(startInfo.entityId);
          const stopConn = ensureConnection(event.entityId);

          const startHas = startConn.ties.some(t => (
            t.partnerId === event.entityId
            && t.sourceId === startInfo.sourceId
            && t.partnerSourceId === event.sourceId
          ));
          const stopHas = stopConn.ties.some(t => (
            t.partnerId === startInfo.entityId
            && t.sourceId === event.sourceId
            && t.partnerSourceId === startInfo.sourceId
          ));

          if (!startHas) {
            startConn.ties.push({
              partnerId: event.entityId,
              type: 'start',
              sourceId: startInfo.sourceId,
              partnerSourceId: event.sourceId,
            });
          }
          if (!stopHas) {
            stopConn.ties.push({
              partnerId: startInfo.entityId,
              type: 'stop',
              sourceId: event.sourceId,
              partnerSourceId: startInfo.sourceId,
            });
          }

          tieStarts.delete(tieKey);
        }
      }
    }

    // Parse slurs in two passes so start/stop events pair in MusicXML timeline order.
    // First pass: collect every slur start/stop event.
    type SlurEvent = {
      type: 'start' | 'stop';
      entityId: string;
      sourceId: string;
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

          // Collect slur events for non-rest note entities.
          if (currentEntityId && !isRest) {
            const sourceId = this.getStableElementId(noteNode);
            noteNode.querySelectorAll('notations > slur').forEach((slurNode) => {
              const type = slurNode.getAttribute('type') as 'start' | 'stop' | 'continue';
              const number = parseInt(slurNode.getAttribute('number') || '1', 10);
              if (type === 'start' || type === 'stop') {
                const globalTick = entityStartTickMap.get(currentEntityId!) ?? 0;
                slurEvents.push({ type, entityId: currentEntityId!, sourceId, staff, number, globalTick });
              }
            });
          }
        }
      }
    });

    // Second pass: sort by global tick and pair matching events.
    slurEvents.sort((a, b) => a.globalTick - b.globalTick);

    const slurStarts: Map<string, { entityId: string; sourceId: string; number: number }> = new Map();
    for (const event of slurEvents) {
      const slurKey = `${event.staff}-${event.number}`;

      if (event.type === 'start') {
        slurStarts.set(slurKey, { entityId: event.entityId, sourceId: event.sourceId, number: event.number });
      } else if (event.type === 'stop') {
        const startInfo = slurStarts.get(slurKey);
        if (startInfo && startInfo.entityId !== event.entityId) {
          const slurId = `slur_${++slurIdCounter}`;
          const partnerIds = [startInfo.entityId, event.entityId];

          const startConn = ensureConnection(startInfo.entityId);
          const stopConn = ensureConnection(event.entityId);

          const startHas = startConn.slurs.some(s => (
            s.partnerIds[0] === startInfo.entityId
            && s.partnerIds[1] === event.entityId
            && s.sourceId === startInfo.sourceId
            && s.partnerSourceIds?.[1] === event.sourceId
          ));
          const stopHas = stopConn.slurs.some(s => (
            s.partnerIds[0] === startInfo.entityId
            && s.partnerIds[1] === event.entityId
            && s.sourceId === event.sourceId
            && s.partnerSourceIds?.[0] === startInfo.sourceId
          ));

          if (!startHas) {
            startConn.slurs.push({
              slurId,
              type: 'start',
              partnerIds,
              sourceId: startInfo.sourceId,
              partnerSourceIds: [startInfo.sourceId, event.sourceId],
            });
          }
          if (!stopHas) {
            stopConn.slurs.push({
              slurId,
              type: 'stop',
              partnerIds,
              sourceId: event.sourceId,
              partnerSourceIds: [startInfo.sourceId, event.sourceId],
            });
          }

          slurStarts.delete(slurKey);
        }
      }
    }

    // Parse beams in two passes so begin/continue/end events group in timeline order.
    // First pass: collect every beam event.
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

    // Second pass: sort by global tick and group matching beam events.
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
