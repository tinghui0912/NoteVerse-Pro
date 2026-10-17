import {SourceChronology} from '../../src/lib/practice/acoustic/source/source-chronology';
import type {CaptureChunk} from '../../src/lib/practice/acoustic/source/capture-types';

export type ChronologyFailure = Readonly<{
  expectedSequence:number; actualSequence:number; expectedSourceStartSampleIndex:number; actualSourceStartSampleIndex:number;
  sourceEndSampleIndex:number; sampleLength:number; sourceSampleRateHz:number; expectedRate:number;
  audioContextStartFrame:number; captureTimeSeconds:number; derivedFrameTime:number; inputChannelCount:number; error:string;
}>;
const failures:ChronologyFailure[]=[];
let installed=false;
export function installChronologyDiagnostics():void {
  if(installed)return;
  installed=true;
  const original=SourceChronology.prototype.accept;
  SourceChronology.prototype.accept=function(chunk:CaptureChunk):void {
    const before=this.snapshot(),expectedRate=Reflect.get(this,'rate') as number;
    const expectedSourceStartSampleIndex=Reflect.get(this,'nextSource') as number;
    try {return original.call(this,chunk);}
    catch(error){
      failures.push(Object.freeze({expectedSequence:before.nextSequence,actualSequence:chunk.sequence,
        expectedSourceStartSampleIndex,actualSourceStartSampleIndex:chunk.sourceStartSampleIndex,
        sourceEndSampleIndex:chunk.sourceEndSampleIndex,sampleLength:chunk.samples?.length,
        sourceSampleRateHz:chunk.sourceSampleRateHz,expectedRate,audioContextStartFrame:chunk.audioContextStartFrame,
        captureTimeSeconds:chunk.captureTimeSeconds,derivedFrameTime:chunk.audioContextStartFrame/expectedRate,
        inputChannelCount:chunk.inputChannelCount,error:String(error)}));
      if(failures.length>32)failures.shift();
      // Instrumentation must preserve the exact production rejection, not repair it.
      throw error;
    }
  };
}
export function chronologyFailures():readonly ChronologyFailure[]{return Object.freeze([...failures]);}
if(typeof window!=='undefined'){
  installChronologyDiagnostics();
  Object.defineProperty(window,'qualificationChronologyFailures',{get:chronologyFailures});
}
declare global {interface Window {readonly qualificationChronologyFailures:readonly ChronologyFailure[]}}
