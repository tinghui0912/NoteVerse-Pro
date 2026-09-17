import type { EditorSelection } from './model';
import type { DomainAnchor } from './render-anchors';
import type { InsertionAnchor } from './rhythmic-input';

export function domainAnchorToEditorSelection(anchor: DomainAnchor): EditorSelection | null {
  if (anchor.kind === 'event') {
    return {
      kind: 'event',
      eventId: anchor.eventId,
    };
  }

  if (anchor.kind === 'noteAtom') {
    return {
      kind: 'noteAtom',
      eventId: anchor.eventId,
      noteAtomId: anchor.noteAtomId,
    };
  }

  if (anchor.kind === 'timelineGap') {
    return {
      kind: 'timelineGap',
      gap: anchor.gap,
    };
  }

  if (anchor.kind === 'derivedRest') {
    return {
      kind: 'derivedRest',
      rest: anchor.rest,
    };
  }

  if (anchor.kind === 'caret') {
    return {
      kind: 'caret',
      position: anchor.position,
      voiceId: anchor.voiceId,
      staffId: anchor.staffId,
    };
  }

  if (anchor.kind === 'notation') {
    return {
      kind: 'notation',
      notationId: anchor.notationId,
    };
  }

  return null;
}

export function editorSelectionToDomainAnchor(selection: EditorSelection): DomainAnchor | null {
  if (selection.kind === 'event') {
    return {
      kind: 'event',
      eventId: selection.eventId,
    };
  }

  if (selection.kind === 'noteAtom') {
    return {
      kind: 'noteAtom',
      eventId: selection.eventId,
      noteAtomId: selection.noteAtomId,
    };
  }

  if (selection.kind === 'timelineGap') {
    return {
      kind: 'timelineGap',
      gap: selection.gap,
    };
  }

  if (selection.kind === 'derivedRest') {
    return {
      kind: 'derivedRest',
      rest: selection.rest,
    };
  }

  if (selection.kind === 'caret') {
    return {
      kind: 'caret',
      position: selection.position,
      staffId: selection.staffId,
      voiceId: selection.voiceId,
    };
  }

  if (selection.kind === 'notation') {
    return {
      kind: 'notation',
      notationId: selection.notationId,
    };
  }

  return null;
}

export function isInspectorSelection(selection: EditorSelection): boolean {
  return (
    selection.kind === 'event'
    || selection.kind === 'noteAtom'
    || selection.kind === 'timelineGap'
    || selection.kind === 'derivedRest'
    || selection.kind === 'notation'
  );
}

export function isCommandInsertionSelection(selection: EditorSelection): boolean {
  return selection.kind === 'caret' || selection.kind === 'timelineGap' || selection.kind === 'derivedRest';
}

export function insertionAnchorToDomainAnchor(anchor: InsertionAnchor): DomainAnchor {
  if (anchor.kind === 'caret') {
    return {
      kind: 'caret',
      position: anchor.caret.position,
      staffId: anchor.caret.staffId,
      voiceId: anchor.caret.voiceId,
    };
  }

  if (anchor.kind === 'timelineGap') {
    return {
      kind: 'timelineGap',
      gap: {
        kind: 'timelineGap',
        voiceId: anchor.voiceId,
        staffId: anchor.staffId,
        start: anchor.gapStart,
        duration: anchor.gapDuration,
      },
    };
  }

  return {
    kind: 'caret',
    position: anchor.position,
    staffId: anchor.staffId,
    voiceId: anchor.voiceId,
  };
}
