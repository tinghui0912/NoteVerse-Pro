import {
  readNumericTimemapValue,
  VerovioScoreAdapter,
} from '@/lib/score/verovio';

export type PracticeVisualTimelineEntry = {
  index: number;
  beat: number;
  noteIds: string[];
  eventId?: string;
  groupId?: string;
};

export type PracticeDisplayAnchor = {
  beat: number;
  event_id?: string | null;
  group_id?: string | null;
  render_note_ids?: string[];
};

export class PracticeVerovioAdapter extends VerovioScoreAdapter {
  private visualTimeline: PracticeVisualTimelineEntry[] = [];

  override async loadMusicXml(xml: string) {
    await super.loadMusicXml(xml, { renderMidi: true, prepareGenericRenderIds: false });
    this.visualTimeline = this.buildVisualTimeline(this.renderTimemap());
  }

  override dispose() {
    this.visualTimeline = [];
    super.dispose();
  }

  getTimelineEntryForBeat(beat: number): PracticeVisualTimelineEntry | null {
    if (!Number.isFinite(beat) || this.visualTimeline.length === 0) {
      return null;
    }

    let bestEntry = this.visualTimeline[0] ?? null;
    let bestDistance = bestEntry ? Math.abs(bestEntry.beat - beat) : Number.POSITIVE_INFINITY;
    for (const entry of this.visualTimeline) {
      const distance = Math.abs(entry.beat - beat);
      if (distance < bestDistance) {
        bestEntry = entry;
        bestDistance = distance;
      }
    }
    return bestEntry;
  }

  getNextTimelineEntryAfterBeat(beat: number): PracticeVisualTimelineEntry | null {
    if (!Number.isFinite(beat) || this.visualTimeline.length === 0) {
      return null;
    }

    const beatEpsilon = 0.001;
    return (
      this.visualTimeline.find((entry) => entry.beat > beat + beatEpsilon) ??
      this.visualTimeline[this.visualTimeline.length - 1] ??
      null
    );
  }

  getTimelineEntryByIndex(index: number): PracticeVisualTimelineEntry | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.visualTimeline.length) {
      return null;
    }
    return this.visualTimeline[index] ?? null;
  }

  getTimelineEntryForDisplayAnchor(anchor: PracticeDisplayAnchor): PracticeVisualTimelineEntry | null {
    const baseEntry =
      this.getTimelineEntryForBeat(anchor.beat) ??
      this.getNextTimelineEntryAfterBeat(anchor.beat);
    if (!baseEntry) {
      return null;
    }

    const renderNoteIds = anchor.render_note_ids?.filter(Boolean) ?? [];
    return {
      ...baseEntry,
      beat: anchor.beat,
      eventId: anchor.event_id ?? undefined,
      groupId: anchor.group_id ?? undefined,
      noteIds: renderNoteIds.length > 0 ? Array.from(new Set(renderNoteIds)) : baseEntry.noteIds,
    };
  }

  private buildVisualTimeline(timemap: Array<Record<string, unknown>>) {
    const groupedByBeat = new Map<number, string[]>();

    for (const entry of timemap) {
      const noteIds = Array.isArray(entry.on)
        ? entry.on.filter((value): value is string => typeof value === 'string')
        : [];
      const beat = readNumericTimemapValue(entry, ['qstamp', 'beat']);
      if (noteIds.length === 0 || beat === null) {
        continue;
      }

      const roundedBeat = Math.round(beat * 1000) / 1000;
      groupedByBeat.set(roundedBeat, [...(groupedByBeat.get(roundedBeat) ?? []), ...noteIds]);
    }

    return Array.from(groupedByBeat.entries())
      .sort(([leftBeat], [rightBeat]) => leftBeat - rightBeat)
      .map(([beat, noteIds], index) => ({
        index,
        beat,
        noteIds: Array.from(new Set(noteIds)),
      }));
  }
}
