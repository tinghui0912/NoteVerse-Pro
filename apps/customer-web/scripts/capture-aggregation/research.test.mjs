import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {instrumentWorklet} from '../qualification/worklet-diagnostics.mjs';
const source=readFileSync(new URL('../../src/lib/practice/acoustic/source/capture.worklet.js',import.meta.url),'utf8');
function execute(text){
 const messages=[];let Processor;
 const scope={Float32Array,Uint8Array,sampleRate:48000,currentFrame:0,currentTime:0,
  AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>messages.push(m)};}},registerProcessor:(_,C)=>{Processor=C;}};
 vm.createContext(scope);vm.runInContext(text,scope);const p=new Processor();
 for(let i=0;i<1600;i++){
  scope.currentFrame=i*128;scope.currentTime=scope.currentFrame/48000;
  p.process([[Float32Array.from({length:128},(_,j)=>(i*128+j)%233/233)]],[]);
  const last=messages.at(-1);if(last?.sequence===p.nextAck)p.port.onmessage({data:{type:'ACK',sequence:last.sequence}});
 }
 return {messages,p};
}
test('instrumented production class is byte/sample/message equivalent; diagnostics bounded',()=>{
 const a=execute(source),b=execute(instrumentWorklet(source));assert.equal(a.messages.length,100);
 for(let i=0;i<a.messages.length;i++){const {__qualificationTransport,...m}=b.messages[i];assert.equal(__qualificationTransport.state,'ACTIVE');
  assert.deepEqual(JSON.parse(JSON.stringify(m)),JSON.parse(JSON.stringify(a.messages[i])));}
 assert.equal(b.p.diagnosticRows.length,64);assert.equal(b.p.diagnosticProcesses.length,64);
});
test('fixed supported envelope and independent cold trials are prospective, STEP forbidden',()=>{
 const c=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
 assert.deepEqual(c.supportedStallsMs,[0,50,100,250,1000]);assert.equal(c.unsupportedStallMs,1700);
 assert.equal(c.coldStartsPerRate,5);assert.equal(c.step.executed,false);assert.equal(c.transportBlockSamples,2048);
});
