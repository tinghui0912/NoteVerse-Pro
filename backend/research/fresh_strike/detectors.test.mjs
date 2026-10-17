import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { groupEvidence, rawEvidence, DEFINITIONS } from './detectors.mjs';
const blank = () => new Float32Array(183 * 88);
test('fixed first-anchor grouping does not chain; token has no pitch/target', () => {
  const tokens = groupEvidence([{anchor: 100,available:1000},{anchor:120,available:1100},{anchor:140,available:1200}],1000,'x','rise');
  assert.equal(tokens.length,2); assert.equal(tokens[0].evidenceAvailableThroughSourceSample,1100);
  assert.deepEqual(Object.keys(tokens[0]).sort(),['candidateId','detectorIdentity','evidenceAvailableThroughSourceSample','sourceAnchorSample','sourceDomainId']);
  assert.ok(Object.isFrozen(tokens[0]));
});
test('steady onset/support is not a new local-rise candidate',()=>{
  const a=blank().fill(.8),f=blank().fill(.8);
  assert.deepEqual(rawEvidence(a,f,{start:0,end:29120,ownedStart:0,ownedEnd:29120},DEFINITIONS.rise),[]);
});
test('half-open ownership; local attack; finite outputs',()=>{
  const a=blank(),f=blank();a[50*88]=.9;f[50*88]=.9;
  const w={start:0,end:29120,ownedStart:8000,ownedEnd:17600};
  assert.equal(rawEvidence(a,f,w,DEFINITIONS.rise).length,1);
  assert.equal(rawEvidence(a,f,{...w,ownedEnd:8000},DEFINITIONS.rise).length,0);
  a[0]=NaN; assert.throws(()=>rawEvidence(a,f,w,DEFINITIONS.rise));
});
test('detector module has no imports/truth/score dependency or model gating',()=>{
  const source=readFileSync(new URL('./detectors.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bimport\b|expectedPitch|stepId|activationGeneration|MIDI|verdict|fetch\(/);
  assert.equal(readdirSync(new URL('../../../apps/customer-web/src/lib/practice/acoustic/model/',import.meta.url)).filter(x=>x==='model-inference.ts').length,1);
});
