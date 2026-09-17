import type {
  DerivedRest,
  EventId,
  MeasureId,
  MusicalPosition,
  NoteAtomId,
  NotationId,
  StaffId,
  TimelineGap,
  VoiceId,
} from './model';

export type RenderId = string;
export type MusicXmlSourceId = string;

export type DomainAnchor =
  | {
      kind: 'event';
      eventId: EventId;
    }
  | {
      kind: 'noteAtom';
      eventId: EventId;
      noteAtomId: NoteAtomId;
    }
  | {
      kind: 'timelineGap';
      gap: TimelineGap;
    }
  | {
      kind: 'derivedRest';
      rest: DerivedRest;
    }
  | {
      kind: 'measure';
      measureId: MeasureId;
    }
  | {
      kind: 'staff';
      measureId: MeasureId;
      staffId: StaffId;
    }
  | {
      kind: 'caret';
      position: MusicalPosition;
      staffId: StaffId;
      voiceId: VoiceId;
    }
  | {
      kind: 'notation';
      notationId: NotationId;
    };

export type RenderAnchor = {
  renderId: RenderId;
  sourceId?: MusicXmlSourceId;
  domain: DomainAnchor;
};

export type RenderAnchorIndex = {
  byRenderId: Map<RenderId, DomainAnchor>;
  bySourceId: Map<MusicXmlSourceId, DomainAnchor[]>;
};

export function createRenderAnchorIndex(anchors: RenderAnchor[]): RenderAnchorIndex {
  const byRenderId = new Map<RenderId, DomainAnchor>();
  const bySourceId = new Map<MusicXmlSourceId, DomainAnchor[]>();

  anchors.forEach((anchor) => {
    byRenderId.set(anchor.renderId, anchor.domain);
    if (anchor.sourceId) {
      bySourceId.set(anchor.sourceId, [...(bySourceId.get(anchor.sourceId) ?? []), anchor.domain]);
    }
  });

  return {
    byRenderId,
    bySourceId,
  };
}

export function resolveDomainAnchorByRenderId(
  index: RenderAnchorIndex,
  renderId: RenderId | null | undefined
): DomainAnchor | null {
  if (!renderId) return null;
  return index.byRenderId.get(renderId) ?? null;
}

export function resolveDomainAnchorsBySourceId(
  index: RenderAnchorIndex,
  sourceId: MusicXmlSourceId | null | undefined
): DomainAnchor[] {
  if (!sourceId) return [];
  return index.bySourceId.get(sourceId) ?? [];
}

export function getRenderIdsForDomainAnchor(anchors: RenderAnchor[], domain: DomainAnchor): RenderId[] {
  return anchors
    .filter((anchor) => isSameDomainAnchor(anchor.domain, domain))
    .map((anchor) => anchor.renderId);
}

export function isSameDomainAnchor(left: DomainAnchor, right: DomainAnchor): boolean {
  if (left.kind !== right.kind) return false;

  if (left.kind === 'event' && right.kind === 'event') {
    return left.eventId === right.eventId;
  }
  if (left.kind === 'noteAtom' && right.kind === 'noteAtom') {
    return left.eventId === right.eventId && left.noteAtomId === right.noteAtomId;
  }
  if (left.kind === 'timelineGap' && right.kind === 'timelineGap') {
    return left.gap === right.gap;
  }
  if (left.kind === 'derivedRest' && right.kind === 'derivedRest') {
    return left.rest === right.rest;
  }
  if (left.kind === 'measure' && right.kind === 'measure') {
    return left.measureId === right.measureId;
  }
  if (left.kind === 'staff' && right.kind === 'staff') {
    return left.measureId === right.measureId && left.staffId === right.staffId;
  }
  if (left.kind === 'caret' && right.kind === 'caret') {
    return left.position.measureId === right.position.measureId
      && left.position.offset.numerator === right.position.offset.numerator
      && left.position.offset.denominator === right.position.offset.denominator
      && left.staffId === right.staffId
      && left.voiceId === right.voiceId;
  }
  if (left.kind === 'notation' && right.kind === 'notation') {
    return left.notationId === right.notationId;
  }

  return false;
}
