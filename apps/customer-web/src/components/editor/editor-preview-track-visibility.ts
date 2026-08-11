import type { ScoreData } from '@/types/score-types';
import { getEditorTrackId, parseVoiceNumber } from '@/lib/editor/tracks';

export type ConnectionEndpointPair = {
  startId: string;
  endId: string;
};

export function getHiddenSourceIds(
  scoreData: ScoreData | null,
  visibleTrackIdSet: Set<string>
): Set<string> {
  const ids = new Set<string>();
  if (!scoreData) return ids;

  scoreData.measures.forEach((measure) => {
    measure.staves.forEach((stave, staveIndex) => {
      stave.voices.forEach((voice) => {
        const xmlVoice = parseVoiceNumber(voice.name);
        const trackId = getEditorTrackId(staveIndex, xmlVoice);
        if (visibleTrackIdSet.has(trackId)) return;

        voice.notes.forEach((entity) => {
          const sourceIds = entity.meta?.sourceIds || (entity.meta?.id ? [entity.meta.id] : []);
          sourceIds.forEach((id) => ids.add(id));
        });
      });
    });
  });

  return ids;
}

export function getHiddenConnectionPairs(
  scoreData: ScoreData | null,
  hiddenSourceIds: Set<string>
): ConnectionEndpointPair[] {
  const pairs: ConnectionEndpointPair[] = [];
  const noteConnections = scoreData?.connections?.noteConnections;
  if (!noteConnections || hiddenSourceIds.size === 0) return pairs;

  noteConnections.forEach((connections, entityId) => {
    connections.ties.forEach((tie) => {
      const startId = tie.sourceId ?? entityId;
      const endId = tie.partnerSourceId ?? tie.partnerId;
      if (hiddenSourceIds.has(startId) || hiddenSourceIds.has(endId)) {
        pairs.push({ startId, endId });
      }
    });

    connections.slurs.forEach((slur) => {
      const startId = slur.sourceId ?? entityId;
      const partnerSourceIds = slur.partnerSourceIds?.length ? slur.partnerSourceIds : slur.partnerIds;
      partnerSourceIds.forEach((partnerId) => {
        if (partnerId === startId) return;
        if (hiddenSourceIds.has(startId) || hiddenSourceIds.has(partnerId)) {
          pairs.push({ startId, endId: partnerId });
        }
      });
    });
  });

  return pairs;
}

export function getHiddenStaffKeys(
  scoreData: ScoreData | null,
  visibleTrackIdSet: Set<string>
): Set<string> {
  const keys = new Set<string>();
  if (!scoreData) return keys;

  scoreData.measures.forEach((measure, measureIndex) => {
    measure.staves.forEach((stave, staveIndex) => {
      const voicesWithEntities = stave.voices.filter((voice) => voice.notes.length > 0);
      if (voicesWithEntities.length === 0) return;

      const allEntityVoicesHidden = voicesWithEntities.every((voice) => {
        const xmlVoice = parseVoiceNumber(voice.name);
        const trackId = getEditorTrackId(staveIndex, xmlVoice);
        return !visibleTrackIdSet.has(trackId);
      });

      if (allEntityVoicesHidden) {
        keys.add(`${measureIndex}:${staveIndex}`);
      }
    });
  });

  return keys;
}
