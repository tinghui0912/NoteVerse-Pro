import { findEntityById, findEntityMetaById } from '@/lib/editor/score-lookup';
import {
  getSlurConnectionDirectionFromXML,
  getTieConnectionDirectionFromXML,
  type ConnectionDirection,
} from '@/lib/musicxml/connections';
import type { EntityInfo, ScoreData, SlurConnection, TieConnection } from '@/types/score-types';

export type ConnectionDetail = {
  id: string;
  type: 'tie' | 'slur';
  currentId: string;
  current: EntityInfo | null;
  partner: EntityInfo | null;
  partnerId: string;
  sourceId?: string;
  partnerSourceId?: string;
  direction: ConnectionDirection;
};

export function getEntitySourcePitch(
  scoreData: ScoreData | null,
  entityId: string,
  sourceId: string | undefined,
  info: EntityInfo | null,
  fallback: string
) {
  const found = findEntityById(scoreData, entityId);
  const entity = found?.entity;
  if (entity?.type === 'chord' && sourceId) {
    const index = entity.meta?.sourceIds?.indexOf(sourceId) ?? -1;
    if (index >= 0 && entity.pitches[index]) return entity.pitches[index];
  }
  if (entity?.type === 'note') return entity.pitch;
  if (entity?.type === 'rest') return fallback;
  if (entity?.type === 'chord') return entity.pitches.join('+');
  if (!info) return fallback;
  return info.pitch;
}

export function buildTieDetails(
  entityId: string | undefined,
  ties: TieConnection[],
  entityInfoMap: Map<string, EntityInfo> | undefined,
  scoreData: ScoreData | null,
  xmlDoc: XMLDocument | null
): ConnectionDetail[] {
  if (!entityId) return [];
  return ties.map((tie, index) => ({
    id: `tie-${entityId}-${tie.partnerId}-${tie.type}-${index}`,
    type: 'tie',
    currentId: entityId,
    current: entityInfoMap?.get(entityId) ?? null,
    partner: entityInfoMap?.get(tie.partnerId) ?? null,
    partnerId: tie.partnerId,
    sourceId: tie.sourceId,
    partnerSourceId: tie.partnerSourceId,
    direction: (() => {
      const entityMeta = findEntityMetaById(scoreData, entityId);
      const partnerMeta = findEntityMetaById(scoreData, tie.partnerId);
      return xmlDoc && entityMeta && partnerMeta
        ? getTieConnectionDirectionFromXML(xmlDoc, entityMeta, partnerMeta, {
          startSourceId: tie.sourceId,
          endSourceId: tie.partnerSourceId,
        })
        : 'auto';
    })(),
  }));
}

export function buildSlurDetails(
  entityId: string | undefined,
  slurs: SlurConnection[],
  entityInfoMap: Map<string, EntityInfo> | undefined,
  scoreData: ScoreData | null,
  xmlDoc: XMLDocument | null
): ConnectionDetail[] {
  if (!entityId) return [];
  return slurs.map((slur, index) => {
    const partnerId = slur.partnerIds.find((id) => id !== entityId) ?? slur.partnerIds[0] ?? '';
    const entityMeta = findEntityMetaById(scoreData, entityId);
    const partnerMeta = findEntityMetaById(scoreData, partnerId);
    const partnerSourceId = slur.partnerSourceIds?.find((id) => id !== slur.sourceId)
      ?? slur.partnerSourceIds?.[0];
    return {
      id: `${slur.slurId}-${entityId}-${partnerId}-${index}`,
      type: 'slur' as const,
      currentId: entityId,
      current: entityInfoMap?.get(entityId) ?? null,
      partner: entityInfoMap?.get(partnerId) ?? null,
      partnerId,
      sourceId: slur.sourceId,
      partnerSourceId,
      direction: xmlDoc && entityMeta && partnerMeta
        ? getSlurConnectionDirectionFromXML(xmlDoc, entityMeta, partnerMeta, {
          startSourceId: slur.sourceId,
          endSourceId: partnerSourceId,
        })
        : 'auto',
    };
  }).filter((detail) => detail.partnerId);
}
