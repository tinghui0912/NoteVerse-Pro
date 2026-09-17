'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useHistory } from '@/contexts/editor-history-context';
import { useScoreData } from '@/contexts/score-data-context';
import { findEntityBySourceIds, type FindEntityResult } from '@/lib/editor/score-lookup';
import {
  addSlurRelationship,
  addTieRelationship,
  compareRational,
  applyInspectorEdit,
  deleteSlurRelationship,
  deleteTieRelationship,
  exportEditorDomainToMusicXml,
  importMusicXmlToEditorDomain,
  findNoteAtomByMusicXmlElementId,
  findVoiceEventByMusicXmlElementIds,
  setEventStemDirectionOverride,
  setSlurRelationshipPlacement,
  setTieRelationshipPlacement,
  updateBeamRelationshipAtEvent,
  type BeamRelationshipAction,
  type FindNoteAtomByMusicXmlElementIdResult,
  type InspectorDraft,
  type InspectorNotationOverrides,
  type NotationPlacementOverride,
  type ScoreDocument,
  type StemDirectionOverride,
} from '@/lib/editor-domain';

export type EditorDomainEditResult =
  | {
      success: true;
      xml: string;
      refreshedSelection: FindEntityResult;
    }
  | {
      success: false;
      error: string;
    };

export function applyEditorDomainEditToXml(params: {
  xml: string;
  draft: InspectorDraft;
  notationOverrides?: InspectorNotationOverrides;
  retargetNoteAtomSourceId?: string;
}): EditorDomainEditResult {
  try {
    const imported = importMusicXmlToEditorDomain(params.xml);
    const draft = params.retargetNoteAtomSourceId
      ? retargetNoteAtomDraft(imported.document, params.draft, params.retargetNoteAtomSourceId)
      : params.draft;

    const edited = applyInspectorEdit(
      imported.document,
      draft,
      params.notationOverrides,
    );

    if (!edited.success) {
      return { success: false, error: edited.error };
    }

    return {
      success: true,
      xml: exportEditorDomainToMusicXml(edited.document),
      refreshedSelection: null,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function useEditorDomainEdit() {
  const t = useTranslations('editor.actions');
  const {
    currentXml,
    currentXmlRef,
    reparseXml,
    setCurrentXml,
  } = useScoreData();
  const history = useHistory();

  const applyDomainInspectorEdit = useCallback((params: {
    draft: InspectorDraft;
    notationOverrides?: InspectorNotationOverrides;
    retargetNoteAtomSourceId?: string;
    reselectSourceIds?: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    const result = applyEditorDomainEditToXml({
      xml: oldXml,
      draft: params.draft,
      notationOverrides: params.notationOverrides,
      retargetNoteAtomSourceId: params.retargetNoteAtomSourceId,
    });
    if (!result.success) {
      return result;
    }

    if (oldXml !== result.xml) {
      history.push(result.xml, params.actionName ?? t('editNote'));
    }
    currentXmlRef.current = result.xml;
    setCurrentXml(result.xml);
    const nextScoreData = reparseXml(result.xml);

    return {
      ...result,
      refreshedSelection: findEntityBySourceIds(nextScoreData, params.reselectSourceIds ?? []),
    };
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const applyDomainStemDirectionToSourceIds = useCallback((params: {
    sourceIds: string[];
    stemDirection?: Extract<StemDirectionOverride, 'up' | 'down'>;
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      let document = imported.document;
      const eventIds = new Set(params.sourceIds
        .map((sourceId) => findVoiceEventByMusicXmlElementIds(document, [sourceId])?.id)
        .filter((eventId): eventId is NonNullable<typeof eventId> => Boolean(eventId)));

      if (eventIds.size === 0) {
        return { success: false, error: 'No domain events match the requested MusicXML source ids.' };
      }

      for (const eventId of eventIds) {
        const result = setEventStemDirectionOverride({
          document,
          eventId,
          stemDirection: params.stemDirection,
        });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        document = result.document;
      }

      const nextXml = exportEditorDomainToMusicXml(document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.sourceIds),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const applyDomainBeamRelationshipEditBySourceId = useCallback((params: {
    sourceId: string;
    action: BeamRelationshipAction;
    reselectSourceIds?: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      const event = findVoiceEventByMusicXmlElementIds(imported.document, [params.sourceId]);
      if (!event) {
        return { success: false, error: 'No domain event matches the requested MusicXML source id.' };
      }

      const result = updateBeamRelationshipAtEvent({
        document: imported.document,
        eventId: event.id,
        action: params.action,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const nextXml = exportEditorDomainToMusicXml(result.document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.reselectSourceIds ?? [params.sourceId]),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const addDomainTieRelationshipsBySourceIds = useCallback((params: {
    startSourceIds: string[];
    endSourceIds: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      let document = imported.document;
      const pairs = resolveNoteAtomPairsBySourceIds(document, params.startSourceIds, params.endSourceIds);
      if (!pairs.success) {
        return { success: false, error: pairs.error };
      }

      for (const pair of pairs.pairs) {
        const [start, stop] = orderNoteAtomEndpoints(document, pair.left, pair.right);
        const result = addTieRelationship({
          document,
          startNoteAtomId: start.note.id,
          stopNoteAtomId: stop.note.id,
        });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        document = result.document;
      }

      const nextXml = exportEditorDomainToMusicXml(document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.startSourceIds),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const addDomainSlurRelationshipsBySourceIds = useCallback((params: {
    startSourceIds: string[];
    endSourceIds: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      let document = imported.document;
      const pairs = resolveNoteAtomPairsBySourceIds(document, params.startSourceIds, params.endSourceIds);
      if (!pairs.success) {
        return { success: false, error: pairs.error };
      }

      for (const pair of pairs.pairs) {
        const [start, stop] = orderNoteAtomEndpoints(document, pair.left, pair.right);
        const result = addSlurRelationship({
          document,
          startNoteAtomId: start.note.id,
          stopNoteAtomId: stop.note.id,
        });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        document = result.document;
      }

      const nextXml = exportEditorDomainToMusicXml(document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.startSourceIds),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const deleteDomainTieRelationshipBySourceIds = useCallback((params: {
    sourceId: string;
    partnerSourceId: string;
    reselectSourceIds?: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      const first = findNoteAtomByMusicXmlElementId(imported.document, params.sourceId);
      const second = findNoteAtomByMusicXmlElementId(imported.document, params.partnerSourceId);
      if (!first || !second) {
        return { success: false, error: 'No domain note atoms match the requested MusicXML source ids.' };
      }

      const relationship = imported.document.tieRelationships.find((candidate) => (
        (candidate.startNoteAtomId === first.note.id && candidate.stopNoteAtomId === second.note.id)
        || (candidate.startNoteAtomId === second.note.id && candidate.stopNoteAtomId === first.note.id)
      ));
      if (!relationship) {
        return { success: false, error: 'Tie relationship does not exist.' };
      }

      const result = deleteTieRelationship({
        document: imported.document,
        tieId: relationship.id,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const nextXml = exportEditorDomainToMusicXml(result.document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.reselectSourceIds ?? [params.sourceId]),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const deleteDomainTieRelationshipsForSourceIds = useCallback((params: {
    sourceIds: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      let document = imported.document;
      const selectedAtomIds = new Set(resolveNoteAtomsBySourceIds(document, params.sourceIds)
        .map((match) => match.note.id));
      if (selectedAtomIds.size === 0) {
        return { success: false, error: 'No domain note atoms match the requested MusicXML source ids.' };
      }

      const relationships = document.tieRelationships.filter((relationship) => (
        selectedAtomIds.has(relationship.startNoteAtomId) || selectedAtomIds.has(relationship.stopNoteAtomId)
      ));
      if (relationships.length === 0) {
        return { success: false, error: 'Tie relationship does not exist.' };
      }

      for (const relationship of relationships) {
        const result = deleteTieRelationship({
          document,
          tieId: relationship.id,
        });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        document = result.document;
      }

      const nextXml = exportEditorDomainToMusicXml(document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.sourceIds),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const setDomainTiePlacementBySourceIds = useCallback((params: {
    sourceId: string;
    partnerSourceId: string;
    placement?: NotationPlacementOverride;
    reselectSourceIds?: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      const first = findNoteAtomByMusicXmlElementId(imported.document, params.sourceId);
      const second = findNoteAtomByMusicXmlElementId(imported.document, params.partnerSourceId);
      if (!first || !second) {
        return { success: false, error: 'No domain note atoms match the requested MusicXML source ids.' };
      }

      const relationship = imported.document.tieRelationships.find((candidate) => (
        (candidate.startNoteAtomId === first.note.id && candidate.stopNoteAtomId === second.note.id)
        || (candidate.startNoteAtomId === second.note.id && candidate.stopNoteAtomId === first.note.id)
      ));
      if (!relationship) {
        return { success: false, error: 'Tie relationship does not exist.' };
      }

      const result = setTieRelationshipPlacement({
        document: imported.document,
        tieId: relationship.id,
        placement: params.placement,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const nextXml = exportEditorDomainToMusicXml(result.document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.reselectSourceIds ?? [params.sourceId]),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const deleteDomainSlurRelationshipBySourceIds = useCallback((params: {
    sourceId: string;
    partnerSourceId: string;
    reselectSourceIds?: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      const first = findNoteAtomByMusicXmlElementId(imported.document, params.sourceId);
      const second = findNoteAtomByMusicXmlElementId(imported.document, params.partnerSourceId);
      if (!first || !second) {
        return { success: false, error: 'No domain note atoms match the requested MusicXML source ids.' };
      }

      const relationship = imported.document.slurRelationships.find((candidate) => (
        (candidate.startNoteAtomId === first.note.id && candidate.stopNoteAtomId === second.note.id)
        || (candidate.startNoteAtomId === second.note.id && candidate.stopNoteAtomId === first.note.id)
      ));
      if (!relationship) {
        return { success: false, error: 'Slur relationship does not exist.' };
      }

      const result = deleteSlurRelationship({
        document: imported.document,
        notationId: relationship.id,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const nextXml = exportEditorDomainToMusicXml(result.document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.reselectSourceIds ?? [params.sourceId]),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const deleteDomainSlurRelationshipsForSourceIds = useCallback((params: {
    sourceIds: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      let document = imported.document;
      const selectedAtomIds = new Set(resolveNoteAtomsBySourceIds(document, params.sourceIds)
        .map((match) => match.note.id));
      if (selectedAtomIds.size === 0) {
        return { success: false, error: 'No domain note atoms match the requested MusicXML source ids.' };
      }

      const relationships = document.slurRelationships.filter((relationship) => (
        selectedAtomIds.has(relationship.startNoteAtomId) || selectedAtomIds.has(relationship.stopNoteAtomId)
      ));
      if (relationships.length === 0) {
        return { success: false, error: 'Slur relationship does not exist.' };
      }

      for (const relationship of relationships) {
        const result = deleteSlurRelationship({
          document,
          notationId: relationship.id,
        });
        if (!result.success) {
          return { success: false, error: result.error };
        }
        document = result.document;
      }

      const nextXml = exportEditorDomainToMusicXml(document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.sourceIds),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  const setDomainSlurPlacementBySourceIds = useCallback((params: {
    sourceId: string;
    partnerSourceId: string;
    placement?: NotationPlacementOverride;
    reselectSourceIds?: string[];
    actionName?: string;
  }): EditorDomainEditResult => {
    const oldXml = currentXmlRef.current ?? currentXml;
    if (!oldXml) {
      return { success: false, error: 'No current MusicXML document is loaded.' };
    }

    try {
      const imported = importMusicXmlToEditorDomain(oldXml);
      const first = findNoteAtomByMusicXmlElementId(imported.document, params.sourceId);
      const second = findNoteAtomByMusicXmlElementId(imported.document, params.partnerSourceId);
      if (!first || !second) {
        return { success: false, error: 'No domain note atoms match the requested MusicXML source ids.' };
      }

      const relationship = imported.document.slurRelationships.find((candidate) => (
        (candidate.startNoteAtomId === first.note.id && candidate.stopNoteAtomId === second.note.id)
        || (candidate.startNoteAtomId === second.note.id && candidate.stopNoteAtomId === first.note.id)
      ));
      if (!relationship) {
        return { success: false, error: 'Slur relationship does not exist.' };
      }

      const result = setSlurRelationshipPlacement({
        document: imported.document,
        notationId: relationship.id,
        placement: params.placement,
      });
      if (!result.success) {
        return { success: false, error: result.error };
      }

      const nextXml = exportEditorDomainToMusicXml(result.document);
      if (oldXml !== nextXml) {
        history.push(nextXml, params.actionName ?? t('editNote'));
      }
      currentXmlRef.current = nextXml;
      setCurrentXml(nextXml);
      const nextScoreData = reparseXml(nextXml);

      return {
        success: true,
        xml: nextXml,
        refreshedSelection: findEntityBySourceIds(nextScoreData, params.reselectSourceIds ?? [params.sourceId]),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [currentXml, currentXmlRef, history, reparseXml, setCurrentXml, t]);

  return {
    addDomainSlurRelationshipsBySourceIds,
    addDomainTieRelationshipsBySourceIds,
    applyDomainBeamRelationshipEditBySourceId,
    applyDomainInspectorEdit,
    applyDomainStemDirectionToSourceIds,
    deleteDomainSlurRelationshipBySourceIds,
    deleteDomainSlurRelationshipsForSourceIds,
    deleteDomainTieRelationshipBySourceIds,
    deleteDomainTieRelationshipsForSourceIds,
    setDomainSlurPlacementBySourceIds,
    setDomainTiePlacementBySourceIds,
  };
}

function retargetNoteAtomDraft(
  document: ReturnType<typeof importMusicXmlToEditorDomain>['document'],
  draft: InspectorDraft,
  sourceId: string,
): InspectorDraft {
  if (draft.kind !== 'noteAtom') return draft;

  const match = findNoteAtomByMusicXmlElementId(document, sourceId);
  if (!match) return draft;

  return {
    ...draft,
    eventId: match.event.id,
    noteAtomId: match.note.id,
  };
}

function resolveNoteAtomPairsBySourceIds(
  document: ScoreDocument,
  startSourceIds: string[],
  endSourceIds: string[],
): {
  success: true;
  pairs: Array<{
    left: FindNoteAtomByMusicXmlElementIdResult;
    right: FindNoteAtomByMusicXmlElementIdResult;
  }>;
} | {
  success: false;
  error: string;
} {
  const startAtoms = resolveNoteAtomsBySourceIds(document, startSourceIds);
  const endAtoms = resolveNoteAtomsBySourceIds(document, endSourceIds);
  if (startAtoms.length === 0 || endAtoms.length === 0) {
    return { success: false, error: 'No domain note atoms match the requested MusicXML source ids.' };
  }

  const count = Math.min(startAtoms.length, endAtoms.length);
  return {
    success: true,
    pairs: Array.from({ length: count }, (_, index) => ({
      left: startAtoms[index],
      right: endAtoms[index],
    })),
  };
}

function resolveNoteAtomsBySourceIds(
  document: ScoreDocument,
  sourceIds: string[],
): FindNoteAtomByMusicXmlElementIdResult[] {
  return [...new Set(sourceIds.filter(Boolean))]
    .map((sourceId) => findNoteAtomByMusicXmlElementId(document, sourceId))
    .filter((match): match is FindNoteAtomByMusicXmlElementIdResult => Boolean(match));
}

function orderNoteAtomEndpoints(
  document: ScoreDocument,
  left: FindNoteAtomByMusicXmlElementIdResult,
  right: FindNoteAtomByMusicXmlElementIdResult,
): [FindNoteAtomByMusicXmlElementIdResult, FindNoteAtomByMusicXmlElementIdResult] {
  return compareVoiceEventOrder(document, left.event, right.event) <= 0
    ? [left, right]
    : [right, left];
}

function compareVoiceEventOrder(
  document: ScoreDocument,
  left: ScoreDocument['events'][number],
  right: ScoreDocument['events'][number],
): number {
  const leftMeasureIndex = document.measures.findIndex((measure) => measure.id === left.position.measureId);
  const rightMeasureIndex = document.measures.findIndex((measure) => measure.id === right.position.measureId);
  if (leftMeasureIndex !== rightMeasureIndex) return leftMeasureIndex - rightMeasureIndex;

  const offsetOrder = compareRational(left.position.offset, right.position.offset);
  if (offsetOrder !== 0) return offsetOrder;

  const voiceOrder = String(left.voiceId).localeCompare(String(right.voiceId));
  if (voiceOrder !== 0) return voiceOrder;

  return String(left.id).localeCompare(String(right.id));
}
