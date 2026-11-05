import {
  assertPracticeScoreArtifact,
  type PracticeScoreArtifact,
} from '@/lib/practice/kernel/artifact';
import { scoreTick } from '@/lib/practice/kernel/score-time';
import { VerovioScoreAdapter } from '@/lib/score/verovio';

export type PracticeVisualTimelineEntry = {
  index: number;
  tick: number;
  endTick: number;
  noteIds: string[];
  eventId?: string;
  groupId?: string;
};

export type PracticeDisplayAnchor = {
  tick: number;
  event_id?: string | null;
  group_id?: string | null;
  render_note_ids?: string[];
};

export class PracticeVerovioAdapter extends VerovioScoreAdapter {
  private visualTimeline: PracticeVisualTimelineEntry[] = [];
  constructor(
    private readonly artifact: PracticeScoreArtifact | null,
    factory?: ConstructorParameters<typeof VerovioScoreAdapter>[0]
  ) {
    super(factory);
  }

  override async loadMusicXml(xml: string) {
    if (!this.artifact)
      throw new Error('Practice artifact required for written rendering.');
    assertPracticeScoreArtifact(this.artifact);
    await super.loadMusicXml(xml, {
      renderMidi: false,
      prepareGenericRenderIds: false,
      toolkitOptions: { expandNever: true },
    });
    this.visualTimeline = this.buildVisualTimeline(this.artifact);
  }

  override dispose() {
    this.visualTimeline = [];
    super.dispose();
  }

  getTimelineEntryForTick(tick: number): PracticeVisualTimelineEntry | null {
    if (!Number.isSafeInteger(tick) || this.visualTimeline.length === 0) {
      return null;
    }

    let bestEntry = this.visualTimeline[0] ?? null;
    let bestDistance = bestEntry
      ? Math.abs(bestEntry.tick - tick)
      : Number.POSITIVE_INFINITY;
    for (const entry of this.visualTimeline) {
      const distance = Math.abs(entry.tick - tick);
      if (distance < bestDistance) {
        bestEntry = entry;
        bestDistance = distance;
      }
    }
    return bestEntry;
  }

  getCursorTimelineEntryForTickRange(
    tick: number,
    startTick: number,
    terminalTick: number,
    allowedNoteIds: readonly string[] = []
  ): PracticeVisualTimelineEntry | null {
    if (
      !Number.isSafeInteger(tick) ||
      !Number.isSafeInteger(startTick) ||
      !Number.isSafeInteger(terminalTick) ||
      terminalTick < startTick
    ) {
      return null;
    }

    const boundedTick = Math.min(Math.max(tick, startTick), terminalTick);
    const allowed = allowedNoteIds.length > 0 ? new Set(allowedNoteIds) : null;
    let cursorEntry: PracticeVisualTimelineEntry | null = null;

    for (const entry of this.visualTimeline) {
      if (entry.tick < startTick) {
        continue;
      }
      if (entry.tick > terminalTick || entry.tick > boundedTick) {
        break;
      }

      const noteIds = allowed
        ? entry.noteIds.filter((noteId) => allowed.has(noteId))
        : entry.noteIds;
      if (noteIds.length === 0) {
        continue;
      }
      cursorEntry = {
        ...entry,
        noteIds: Array.from(new Set(noteIds)),
      };
    }

    return cursorEntry;
  }

  getNextTimelineEntryAfterTick(
    tick: number
  ): PracticeVisualTimelineEntry | null {
    if (!Number.isSafeInteger(tick) || this.visualTimeline.length === 0) {
      return null;
    }

    return (
      this.visualTimeline.find((entry) => entry.tick > tick) ??
      this.visualTimeline[this.visualTimeline.length - 1] ??
      null
    );
  }

  getTimelineEntryByIndex(index: number): PracticeVisualTimelineEntry | null {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.visualTimeline.length
    ) {
      return null;
    }
    return this.visualTimeline[index] ?? null;
  }

  getTimelineEntryForDisplayAnchor(
    anchor: PracticeDisplayAnchor
  ): PracticeVisualTimelineEntry | null {
    scoreTick(anchor.tick);
    const baseEntry =
      this.getTimelineEntryForTick(anchor.tick) ??
      this.getNextTimelineEntryAfterTick(anchor.tick);
    if (!baseEntry) {
      return null;
    }

    const renderNoteIds = anchor.render_note_ids?.filter(Boolean) ?? [];
    return {
      ...baseEntry,
      tick: anchor.tick,
      eventId: anchor.event_id ?? undefined,
      groupId: anchor.group_id ?? undefined,
      noteIds:
        renderNoteIds.length > 0
          ? Array.from(new Set(renderNoteIds))
          : baseEntry.noteIds,
    };
  }

  private buildVisualTimeline(
    artifact: PracticeScoreArtifact
  ): PracticeVisualTimelineEntry[] {
    const events = new Map(
      artifact.events.map((event) => [event.eventId, event])
    );
    const groups = new Map<number, { endTick: number; noteIds: string[] }>();
    for (const note of artifact.notes) {
      const event = events.get(note.eventId);
      if (!event) throw new Error('Missing Practice notation event.');
      const group = groups.get(event.onsetTick) ?? {
        endTick: event.onsetTick,
        noteIds: [],
      };
      group.endTick = Math.max(
        group.endTick,
        event.onsetTick + event.durationTicks
      );
      group.noteIds.push(note.renderNoteId);
      groups.set(event.onsetTick, group);
    }
    return [...groups]
      .sort(([a], [b]) => a - b)
      .map(([tick, group], index) => ({
        index,
        tick,
        endTick: group.endTick,
        noteIds: [...new Set(group.noteIds)],
      }));
  }
}
