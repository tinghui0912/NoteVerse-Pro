import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizedPitchSet, repeatedGestureKind, physicalPair} from './repeated-gesture.mjs';

const source = {recordingId:'fixture', audioSha256:'a'.repeat(64), midiSha256:'b'.repeat(64)};
const pair = (a, b, gap=.225) => physicalPair(source,
  {gestureId:'g0', onsetSeconds:0, pitches:a}, {gestureId:'g1', onsetSeconds:gap, pitches:b});

test('single same-pitch repeat is eligible; a different single is not', () => {
  assert.equal(pair([60], [60]).eligibleBusySingle, true);
  assert.equal(pair([60], [61]).kind, null);
});
test('exact repeated chord normalizes pitch order and duplicate note identities', () => {
  const p = pair([67, 60, 64, 60], [64, 67, 60]);
  assert.equal(p.kind, 'EXACT_REPEATED_CHORD');
  assert.equal(p.eligibleRapidRepeatedGesture, true);
  assert.equal(p.eligibleBusySingle, false);
  assert.deepEqual(p.firstPitchSet, [60,64,67]);
});
for (const [a, b] of [[[60,64,67],[60,65,69]], [[60,64],[60,64,67]], [[60],[60,64]]]) {
  test(`shared pitches are insufficient: ${a.join(',')} -> ${b.join(',')}`, () => {
    assert.equal(repeatedGestureKind(a,b), null);
    assert.equal(pair(a,b).eligibleRapidRepeatedGesture, false);
  });
}
test('the existing 200..250ms metadata band is not widened', () => {
  for (const gap of [.2,.25]) assert.equal(pair([60],[60],gap).eligibleBusySingle, true);
  for (const gap of [.199,.251]) assert.equal(pair([60],[60],gap).eligibleBusySingle, false);
});
test('pair identity freezes both whole gestures, source hashes and onsets', () => {
  const a = pair([60],[60]), b = pair([60],[60],.23);
  assert.notEqual(a.pairId,b.pairId);
  assert.equal(a.firstGestureId,'g0'); assert.equal(a.secondGestureId,'g1');
  assert.equal(a.midiSha256,source.midiSha256); assert.equal(a.audioSha256,source.audioSha256);
  assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.firstPitchSet));
});
test('invalid or missing complete gesture identities fail closed', () => {
  for (const values of [[],[NaN],[60.5],[-1],[128]]) assert.throws(() => normalizedPitchSet(values));
  assert.throws(() => physicalPair(source,{gestureId:'a',onsetSeconds:1,pitches:[60]},{gestureId:'a',onsetSeconds:2,pitches:[60]}));
  assert.throws(() => pair([60],[60],0));
});
test('historical different-pitch pairs remain excluded without editing their artifacts', () => {
  assert.equal(pair([58,72],[57],.235).kind,null);
  assert.equal(pair([49],[70],.229).kind,null);
});
test('classification has no model, score, old loose helper or result-dependent import', () => {
  const text = readFileSync(new URL('./repeated-gesture.mjs',import.meta.url),'utf8');
  const imports = [...text.matchAll(/from ['"]([^'"]+)['"]/g)].map(m=>m[1]);
  assert.deepEqual(imports,['node:crypto']);
  assert.doesNotMatch(text,/sharedPitches|StepTarget|StepPracticeRuntime|MATCH|MISMATCH|onnx|decoded|raw_output/);
});
