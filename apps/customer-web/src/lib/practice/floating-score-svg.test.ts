// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { applyFloatingScoreSvgStyle } from './floating-score-svg';

describe('floating score SVG styling', () => {
  it('makes visible notation light while preserving transparent and definition geometry', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = `
      <defs>
        <path id="glyph" fill="#000000" d="M0 0h10v10z"></path>
      </defs>
      <rect fill="#ffffff" x="0" y="0" width="100" height="100"></rect>
      <path fill="#000000" stroke="#111111" d="M0 10h100"></path>
      <path fill="none" stroke="#000000" d="M0 20h100"></path>
      <use href="#glyph"></use>
      <text fill="#000000">Piano</text>
    `;

    applyFloatingScoreSvgStyle(svg);

    const visiblePath = svg.querySelector('path:not([id])')!;
    expect(visiblePath.getAttribute('fill')).toBe('#f8fafc');
    expect(visiblePath.getAttribute('stroke')).toBe('#f8fafc');
    expect(svg.querySelector('path[fill="none"]')?.getAttribute('stroke')).toBe('#f8fafc');
    expect(svg.querySelector('defs path')?.getAttribute('fill')).toBe('#000000');
    expect(svg.querySelector('use')?.getAttribute('fill')).toBe('#f8fafc');
    expect(svg.querySelector('text')?.getAttribute('fill')).toBe('#f8fafc');
  });
});
