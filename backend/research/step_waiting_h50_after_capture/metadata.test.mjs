import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fixedRapidPair, selectedOccurrenceAudit, otherRapidEvents} from './metadata.mjs';

const group = (time, pitches) => ({time, notes: pitches.map(pitch => ({pitch, time}))});
test('rapid different pitches do not establish a same-pitch retrigger', () => {
  assert.equal(fixedRapidPair(group(1, [58, 72]), group(1.235, [57])).eligibleRapidSamePitchOrChord, false);
});
test('same pitch and repeated chord are detected from MIDI metadata alone', () => {
  assert.equal(fixedRapidPair(group(1, [60]), group(1.225, [60])).eligibleRapidSamePitchOrChord, true);
  assert.equal(fixedRapidPair(group(1, [60, 64]), group(1.225, [64, 60])).exactRepeatedChord, true);
});
test('an unrelated context occurrence cannot be relabeled as the selected intended occurrence', () => {
  const truth = [group(1, [60]), group(1.225, [60]), group(4, [60])];
  const c = {id:'test', topology:'single', source:{recordingId:'test', audioSha256:'a', midiSha256:'m'},
    intendedTime:4, selected:{physical:truth[2]}, truth};
  assert.equal(selectedOccurrenceAudit(c).intendedContainsRapidSamePitch, false);
  assert.equal(otherRapidEvents(c).length, 1);
  assert.equal(otherRapidEvents(c)[0].selectedIntendedOccurrence, false);
});
test('fixed corpus contains fast different-pitch pairs but no selected rapid same-pitch opportunity', () => {
  const root = path.resolve(import.meta.dirname, '../../..');
  const cases = JSON.parse(readFileSync(path.join(root, 'backend/data/work/step_waiting_topology_v3/corpus-v4/truth.json'))).cases;
  const rows = cases.map(selectedOccurrenceAudit);
  assert.equal(rows.length, 28);
  assert.equal(rows.filter(r => r.intendedContainsRapidSamePitch || r.selectedPair?.eligibleRapidSamePitchOrChord).length, 0);
  assert.equal(rows.filter(r => r.topology === 'rapid_not_ready').length, 2);
  assert.ok(cases.flatMap(otherRapidEvents).length > 0);
});
