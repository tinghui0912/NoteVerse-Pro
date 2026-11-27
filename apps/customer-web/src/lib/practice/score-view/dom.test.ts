// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { findScoreElementByRenderId, findScoreGraphicsElementByRenderId } from './dom';
afterEach(() => vi.unstubAllGlobals());
it.each(['note:1', 'note with spaces', 'quoted"id', 'bracket[id]'])('looks up exact render identity %s without remapping', id => {
  const container = document.createElement('div');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const note = document.createElementNS(svg.namespaceURI, 'g'); note.setAttribute('data-id', id); svg.append(note); container.append(svg);
  expect(findScoreElementByRenderId(container, id)).toBe(note);
  expect(findScoreGraphicsElementByRenderId(container, id)).toBe(note);
  expect(findScoreElementByRenderId(container, 'absent')).toBeNull();
});
it('resolves an exact SVG id when CSS.escape is unavailable', () => {
  vi.stubGlobal('CSS', undefined);
  const container = document.createElement('div'); container.innerHTML = '<svg><g id="note:1"></g></svg>';
  expect(findScoreElementByRenderId(container, 'note:1')).toBe(container.querySelector('g'));
});
