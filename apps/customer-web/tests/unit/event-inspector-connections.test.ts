// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { editorDocument, note } from '../fixtures/editor';
import { addSlurRelationship, addTieRelationship } from '@/lib/editor-domain';
import {
  buildDomainSlurDetails,
  buildDomainTieDetails,
  getEntitySourcePitch,
} from '@/components/editor/event-inspector-connections';
it('projects connected notes and pitch from domain identity and source anchors', () => {
  let document = editorDocument(note('a') + note('b'));
  const event = document.events[0];
  if (event.kind !== 'pitched') throw new Error('pitched required');
  const tie = addTieRelationship({
    document,
    startNoteAtomId: 'a' as never,
    stopNoteAtomId: 'b' as never,
  });
  if (!tie.success) throw new Error(tie.error);
  document = tie.document;
  const slur = addSlurRelationship({
    document,
    startNoteAtomId: 'a' as never,
    stopNoteAtomId: 'b' as never,
  });
  if (!slur.success) throw new Error(slur.error);
  document = slur.document;
  expect(buildDomainTieDetails({ document, event })).toMatchObject([
    { sourceId: 'a', partnerSourceId: 'b', direction: 'auto' },
  ]);
  expect(buildDomainSlurDetails({ document, event })).toMatchObject([
    {
      partner: { pitch: { step: 'C', octave: 4 }, measureNumber: 1, voiceNumber: 1, staffIndex: 0 },
    },
  ]);
  expect(getEntitySourcePitch(document, '', 'b', null, '?')).toBe('C4');
  expect(getEntitySourcePitch(document, '', 'missing', null, '?')).toBe('?');
});
