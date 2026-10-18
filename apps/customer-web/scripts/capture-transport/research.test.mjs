import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {instrumentWorklet} from '../qualification/worklet-diagnostics.mjs';
const source=readFileSync(new URL('../../src/lib/practice/acoustic/source/capture.worklet.js',import.meta.url),'utf8');
function execute(text){
 const messages=[];let Processor;
 const sandbox={Float32Array,sampleRate:48000,currentFrame:0,currentTime:0,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>messages.push(message)};}},registerProcessor:(_,value)=>{Processor=value;}};
 vm.createContext(sandbox);vm.runInContext(text,sandbox);const processor=new Processor();
 for(let i=0;i<300;i++){
  sandbox.currentFrame=i*128;sandbox.currentTime=sandbox.currentFrame/48000;
  processor.process([[Float32Array.from({length:128},(_,j)=>(i*128+j)%233/233)]],[[new Float32Array(128)]]);
  const last=messages.at(-1);
  if(last?.type==='pcm-chunk'&&last.sequence===processor.nextAck)processor.port.onmessage({data:{type:'ACK',sequence:last.sequence}});
 }
 return {messages,processor};
}
test('instrumentation preserves every production sample and message field',()=>{
 const plain=execute(source),instrumented=execute(instrumentWorklet(source));
 assert.equal(plain.messages.length,instrumented.messages.length);
 for(let i=0;i<plain.messages.length;i++){
  const {__qualificationTransport,...value}=instrumented.messages[i];
  assert.ok(__qualificationTransport);
  assert.deepEqual(JSON.parse(JSON.stringify(value)),JSON.parse(JSON.stringify(plain.messages[i])));
 }
 assert.equal(instrumented.processor.diagnosticRows.length,64);
});
test('stress matrix and disabled STEP are frozen, not chosen from results',()=>{
 const contract=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
 assert.deepEqual(contract.diagnosticMatrix.mainThreadStallsMs,[0,50,100,250]);
 assert.equal(contract.stepExecution,'FORBIDDEN');assert.equal(contract.capabilities.productionMicrophone,false);
});
