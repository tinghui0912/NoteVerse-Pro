import {test} from 'node:test';
import assert from 'node:assert/strict';
import {matchTruth} from './truth-matching.mjs';
const n=(id,timeMs,pitch=60)=>({id,timeMs,pitch});
test('inclusive endpoints, stable identity, same pitch and one-to-one',()=>{
  const a=[n('a',1000),n('b',1500)],b=[n('y',1250),n('x',750),n('wrong',1500,61)];
  const r=matchTruth(a,b); assert.equal(r.matchedCount,2);assert.equal(r.unmatchedCount,1);
  assert.deepEqual(r,matchTruth(a.toReversed(),b.toReversed()));
});
test('max cardinality before minimum error, duplicates cannot reuse',()=>{
  const r=matchTruth([n('a',1000),n('b',1400)],[n('x',800),n('y',1200)]);
  assert.equal(r.matchedCount,2);assert.equal(new Set(r.pairs.map(p=>p.observationId)).size,2);
});
test('silence and out-of-window evidence are explicit',()=>{
  assert.equal(matchTruth([],[]).precision,null);
  assert.equal(matchTruth([n('a',0)],[n('o',251)]).matchedCount,0);
});
