// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { clearRangeOverlay, syncRangeOverlay, isRangeBackgroundMutation } from './range-overlay';
import { SCORE_DECORATIONS } from './decorations';
it('merges the selected system boxes with unchanged padding and clears only owned decorations', () => {
  const container = document.createElement('div'); container.innerHTML = '<svg><g class="system"><g data-id="a"/><g data-id="b"/></g></svg>';
  const system = container.querySelector<SVGGraphicsElement>('.system')!;
  system.getBBox = () => DOMRect.fromRect({ x: 0, y: 10, width: 200, height: 100 });
  const notes = [...container.querySelectorAll<SVGGraphicsElement>('[data-id]')];
  notes[0].getBBox = () => DOMRect.fromRect({ x: 20, y: 20, width: 10, height: 10 });
  notes[1].getBBox = () => DOMRect.fromRect({ x: 80, y: 30, width: 10, height: 10 });
  syncRangeOverlay(container, ['a', 'a', 'b', 'missing']);
  const rect = container.querySelector('rect')!;
  expect([rect.getAttribute('x'), rect.getAttribute('y'), rect.getAttribute('width'), rect.getAttribute('height'), rect.getAttribute('rx')]).toEqual(['12', '2', '86', '116', '4']);
  expect(container.querySelectorAll('.' + SCORE_DECORATIONS.rangeSelected)).toHaveLength(2);
  syncRangeOverlay(container, ['b']); expect(container.querySelectorAll('rect')).toHaveLength(1);
  clearRangeOverlay(container); expect(container.querySelector('rect')).toBeNull();
  expect(container.querySelectorAll('[data-id]')).toHaveLength(2);
});
it('recognizes only overlay mutations so the React observer avoids self-triggered updates', () => {
  const rect = document.createElement('rect'); rect.setAttribute(SCORE_DECORATIONS.rangeBackgroundAttribute, 'true');
  const mutation = { addedNodes: [rect], removedNodes: [] } as unknown as MutationRecord;
  expect(isRangeBackgroundMutation(mutation)).toBe(true);
  expect(isRangeBackgroundMutation({ addedNodes: [document.createElement('g')], removedNodes: [] } as unknown as MutationRecord)).toBe(false);
});
