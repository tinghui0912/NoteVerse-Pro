import type { EntityMeta } from '@/types/score-types';

function getEntityGlobalTick(meta: EntityMeta) {
  return meta.measureIndex * 1_000_000 + (meta.startTick ?? 0);
}

export function orderConnectionEndpoints(start: EntityMeta, end: EntityMeta) {
  return getEntityGlobalTick(start) <= getEntityGlobalTick(end)
    ? [start, end] as const
    : [end, start] as const;
}
