import { it, expect } from 'vitest';
import {
  createDefaultEditableEvent,
  addPitch,
  removePitch,
  getEditableEventDisplayKind,
} from './event-inspector-editable-event';
it('keeps explicit rest and pitched form drafts distinct', () => {
  const rest = createDefaultEditableEvent();
  expect(getEditableEventDisplayKind(rest)).toBe('explicitRest');
  const pitched = addPitch(rest, 'D4');
  expect(getEditableEventDisplayKind(pitched)).toBe('singleNote');
  expect(removePitch(pitched, 0)).toBe(pitched);
  const chord = addPitch(pitched, 'F4');
  expect(getEditableEventDisplayKind(chord)).toBe('chord');
  expect(removePitch(chord, 0).pitches).toEqual(['F4']);
});
