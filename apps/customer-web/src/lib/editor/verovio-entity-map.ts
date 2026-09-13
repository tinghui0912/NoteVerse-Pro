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
const VEROVIO_MEASURE_SELECTOR = '[data-class="measure"], .measure';
const VEROVIO_STAFF_SELECTOR = '[data-class="staff"], .staff';
const VEROVIO_SPACE_SELECTOR = '[data-class="space"]';

export function getVerovioRenderElementIdFromTarget(target: EventTarget | null): string | null {
  const candidate = getVerovioElementFromTarget(target);
  return candidate ? getCandidateId(candidate) : null;
}

export function getVerovioElementFromTarget(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;

  const event = target.closest(VEROVIO_EVENT_SELECTOR);
  if (event) return event;

  const fallback = target.closest('[data-id], [id]');
  return fallback?.matches(VEROVIO_SPACE_SELECTOR) ? null : fallback;
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
