// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { editorDocument, note } from '../fixtures/editor';
import {
  getHiddenSourceIds,
  getHiddenStaffKeys,
  getHiddenConnectionPairs,
} from '@/components/editor/editor-preview-track-visibility';
import { addSlurRelationship } from '@/lib/editor-domain';
it('derives hidden source IDs and staff visibility from domain voices and events', () => {
  const document = editorDocument(note('a', 'C', 1) + note('b', 'D', 2));
  const visible = new Set([document.voices[0].id]);
  expect([...getHiddenSourceIds(document, visible)]).toEqual(['b']);
  expect([...getHiddenStaffKeys(document, visible)]).toEqual([]);
  expect([...getHiddenStaffKeys(document, new Set())]).toEqual(['0:0']);
  expect(getHiddenSourceIds(null, visible).size).toBe(0);
});
it('hides a connection when its domain endpoint is hidden', () => {
  const document = editorDocument(note('a', 'C', 1) + note('b', 'D', 2));
  const command = addSlurRelationship({
    document,
    startNoteAtomId: 'a' as never,
    stopNoteAtomId: 'b' as never,
  });
  expect(command.success).toBe(true);
  if (!command.success) return;
  expect(getHiddenConnectionPairs(new Set(['b']), command.document)).toEqual([
    { startId: 'a', endId: 'b' },
  ]);
});
