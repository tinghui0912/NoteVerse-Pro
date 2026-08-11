import type { EntityLocation, ScoreData, ScoreEntity } from '@/types/score-types';

export type VerovioEntityHit = {
  entity: ScoreEntity;
  location: EntityLocation;
};

function getCandidateId(element: Element): string | null {
  return (
    element.getAttribute('data-id') ||
    element.getAttribute('id') ||
    null
  );
}

const VEROVIO_EVENT_SELECTOR = [
  '[data-class="note"]',
  '[data-class="rest"]',
  '[data-class="mRest"]',
].join(', ');
const VEROVIO_SPACE_SELECTOR = '[data-class="space"]';
const VEROVIO_MEASURE_SELECTOR = '[data-class="measure"], .measure';
const VEROVIO_STAFF_SELECTOR = '[data-class="staff"], .staff';

export function getVerovioElementIdFromTarget(target: EventTarget | null): string | null {
  const candidate = getVerovioElementFromTarget(target);
  return candidate ? getCandidateId(candidate) : null;
}

export function getVerovioElementFromTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;

  const renderedEvent = target.closest(VEROVIO_EVENT_SELECTOR);
  if (renderedEvent) return renderedEvent;

  const genericCandidate = target.closest('[data-id], [id]');
  const spaceCandidate = target.closest(VEROVIO_SPACE_SELECTOR);
  if (spaceCandidate && genericCandidate && spaceCandidate.contains(genericCandidate)) {
    return null;
  }

  return genericCandidate;
}

export function getVerovioMeasureElementFromTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;

  return target.closest(VEROVIO_MEASURE_SELECTOR);
}

export function getVerovioMeasureIndexFromTarget(container: Element | null, target: EventTarget | null): number | null {
  const measure = getVerovioMeasureElementFromTarget(target);
  if (!container || !measure) return null;

  const measures = Array.from(container.querySelectorAll(VEROVIO_MEASURE_SELECTOR));
  const index = measures.indexOf(measure);
  return index >= 0 ? index : null;
}

export function getVerovioStaffElementForIndex(measureElement: Element | null, staveIndex: number): Element | null {
  if (!measureElement) return null;

  const staves = Array.from(measureElement.querySelectorAll(VEROVIO_STAFF_SELECTOR))
    .filter((staff) => staff.closest(VEROVIO_MEASURE_SELECTOR) === measureElement);

  return staves[staveIndex] ?? null;
}

export function findScoreEntityById(scoreData: ScoreData | null, entityId: string | null): VerovioEntityHit | null {
  if (!scoreData || !entityId) return null;

  for (const [measureIndex, measure] of scoreData.measures.entries()) {
    for (const [staveIndex, stave] of measure.staves.entries()) {
      for (const voice of stave.voices) {
        for (const [entityIndex, entity] of voice.notes.entries()) {
          const meta = entity.meta;
          if (!meta) continue;

          const sourceIds = meta.sourceIds || [];
          if (meta.id !== entityId && !sourceIds.includes(entityId)) continue;

          return {
            entity,
            location: {
              measureIndex,
              staveIndex,
              xmlVoice: meta.xmlVoice,
              entityIndex,
            },
          };
        }
      }
    }
  }

  return null;
}
