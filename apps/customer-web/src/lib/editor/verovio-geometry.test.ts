// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  getDirectMeasureElements,
  getDirectStaffElements,
  getMeasureElementFromPoint,
  getMeasureHorizontalBounds,
  getMeasureIndex,
  getStaveIndexFromPointer,
} from './verovio-geometry';

function setRect(element: Element, rect: Partial<DOMRect>) {
  const resolved = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 0),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 0),
    width: rect.width ?? Math.max(0, (rect.right ?? 0) - (rect.left ?? 0)),
    height: rect.height ?? Math.max(0, (rect.bottom ?? 0) - (rect.top ?? 0)),
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => resolved;
}

function measure(id: string, rect: Partial<DOMRect>) {
  const element = document.createElement('g');
  element.setAttribute('data-class', 'measure');
  element.setAttribute('data-id', id);
  setRect(element, rect);
  return element;
}

function staff(rect: Partial<DOMRect>) {
  const element = document.createElement('g');
  element.setAttribute('data-class', 'staff');
  setRect(element, rect);
  return element;
}

describe('Verovio geometry helpers', () => {
  it('returns only direct measures and direct staves', () => {
    const container = document.createElement('svg');
    const first = measure('m1', {});
    const nestedMeasure = measure('nested', {});
    const directStaff = staff({});
    const nestedStaff = staff({});

    nestedMeasure.appendChild(nestedStaff);
    first.append(directStaff, nestedMeasure);
    container.appendChild(first);

    expect(getDirectMeasureElements(container)).toEqual([first]);
    expect(getDirectStaffElements(first)).toEqual([directStaff]);
  });

  it('uses staff bounds as measure horizontal bounds when available', () => {
    const element = measure('m1', { left: 80, right: 420, width: 340 });
    element.append(
      staff({ left: 100, right: 250, width: 150 }),
      staff({ left: 120, right: 400, width: 280 })
    );

    expect(getMeasureHorizontalBounds(element)).toMatchObject({
      left: 100,
      right: 400,
      width: 300,
    });
  });

  it('finds measure and staff indexes from pointer geometry', () => {
    const container = document.createElement('svg');
    const first = measure('m1', { left: 0, right: 100, width: 100, top: 0, bottom: 100, height: 100 });
    const second = measure('m2', { left: 120, right: 220, width: 100, top: 0, bottom: 100, height: 100 });
    second.append(
      staff({ left: 120, right: 220, width: 100, top: 0, bottom: 40, height: 40 }),
      staff({ left: 120, right: 220, width: 100, top: 60, bottom: 100, height: 40 })
    );
    container.append(first, second);

    expect(getMeasureElementFromPoint(container, 150, 20)).toBe(second);
    expect(getMeasureIndex(container, second)).toBe(1);
    expect(getStaveIndexFromPointer(second, 85)).toBe(1);
  });
});
