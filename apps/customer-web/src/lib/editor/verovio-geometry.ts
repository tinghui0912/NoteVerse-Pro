const VEROVIO_MEASURE_SELECTOR = '[data-class="measure"], .measure';
const VEROVIO_STAFF_SELECTOR = '[data-class="staff"], .staff';

export function getDirectStaffElements(measureElement: Element | null): Element[] {
  if (!measureElement) return [];

  return Array.from(measureElement.querySelectorAll(VEROVIO_STAFF_SELECTOR))
    .filter((staff) => staff.closest(VEROVIO_MEASURE_SELECTOR) === measureElement);
}

export function getDirectMeasureElements(container: Element | null): Element[] {
  if (!container) return [];

  return Array.from(container.querySelectorAll(VEROVIO_MEASURE_SELECTOR))
    .filter((measure) => !measure.parentElement?.closest(VEROVIO_MEASURE_SELECTOR));
}

export function getMeasureHorizontalBounds(measureElement: Element) {
  const staffRects = getDirectStaffElements(measureElement)
    .map((staff) => staff.getBoundingClientRect())
    .filter((rect) => rect.width > 0);
  if (staffRects.length === 0) return measureElement.getBoundingClientRect();

  const left = Math.min(...staffRects.map((rect) => rect.left));
  const right = Math.max(...staffRects.map((rect) => rect.right));
  return { left, right, width: Math.max(1, right - left) };
}

export function getMeasureElementFromPoint(container: Element | null, clientX: number, clientY: number): Element | null {
  const measures = getDirectMeasureElements(container);
  const tolerance = 8;
  let nearestMeasure: Element | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  measures.forEach((measure) => {
    const rect = measure.getBoundingClientRect();
    const horizontal = getMeasureHorizontalBounds(measure);
    const containsPoint = clientX >= horizontal.left - tolerance
      && clientX <= horizontal.right + tolerance
      && clientY >= rect.top - tolerance
      && clientY <= rect.bottom + tolerance;
    if (!containsPoint) return;

    const centerX = horizontal.left + horizontal.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(clientX - centerX, clientY - centerY);
    if (distance < nearestDistance) {
      nearestMeasure = measure;
      nearestDistance = distance;
    }
  });

  return nearestMeasure;
}

export function getMeasureIndex(container: Element | null, measureElement: Element | null): number | null {
  if (!container || !measureElement) return null;
  const measures = getDirectMeasureElements(container);
  const index = measures.indexOf(measureElement);
  return index >= 0 ? index : null;
}

export function getStaveIndexFromPointer(measureElement: Element | null, clientY: number): number | null {
  const staves = getDirectStaffElements(measureElement);
  if (staves.length === 0) return null;

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  staves.forEach((staff, index) => {
    const rect = staff.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    const distance = Math.abs(clientY - centerY);
    if (distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  });

  return nearestIndex;
}
