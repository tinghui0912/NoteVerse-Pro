import { Xc6Source48000 } from '../src/lib/practice/acoustic-inference/xc6-source-48000';
import { sha256 } from '../src/lib/practice/acoustic-inference/xc4-robust-runtime-contract';

export async function qualifyBrowserDsp(bytes:Uint8Array){
  const reference=await(await fetch('/dsp-reference.json')).json(),rows=[];
  for(const fixture of reference.fixtures){
    const a=await(await fetch('/dsp/'+fixture.input)).arrayBuffer(),b=await(await fetch('/dsp/'+fixture.reference)).arrayBuffer();
    if(await sha256(new Uint8Array(a))!==fixture.inputSha256||await sha256(new Uint8Array(b))!==fixture.referenceSha256)throw new Error('XC6_DSP_FIXTURE_DRIFT');
    const input=new Float32Array(a),expected=new Float32Array(b),single=await Xc6Source48000.create(bytes),chunked=await Xc6Source48000.create(bytes);
    const actual=single.push(input).samples,joined:number[]=[];
    for(let n=0;n<input.length;n+=137)joined.push(...chunked.push(input.subarray(n,n+137)).samples);
    let maxAbs=0,sum=0,chunkError=0;
    if(actual.length!==expected.length||joined.length!==actual.length)throw new Error('XC6_DSP_COUNT_DRIFT');
    for(let n=0;n<actual.length;n++){const e=actual[n]-expected[n];maxAbs=Math.max(maxAbs,Math.abs(e));sum+=e*e;chunkError=Math.max(chunkError,Math.abs(actual[n]-joined[n]));}
    const rms=actual.length?Math.sqrt(sum/actual.length):0;
    if(maxAbs>reference.frozenNumericTolerance.maxAbs||rms>reference.frozenNumericTolerance.rms||chunkError!==0)throw new Error('XC6_DSP_PARITY_FAILED');
    rows.push({id:fixture.id,outputSamples:actual.length,sampleCountIdentity:true,maxAbs,rms,chunkVsSingleMaxAbs:chunkError});
  }
  return{status:'XC6_48000_BROWSER_FIR_REFERENCE_PARITY_PASS',scipyVersion:reference.scipyVersion,rows,
    tolerance:reference.frozenNumericTolerance,algorithmicLookaheadMs:.625,noPaddedFuture:true};
}
