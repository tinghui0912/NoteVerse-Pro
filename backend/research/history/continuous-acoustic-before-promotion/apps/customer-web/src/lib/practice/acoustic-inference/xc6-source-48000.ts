import qualified from './xc6-source-identities.json';
import { canonicalJson,sha256 } from './xc4-robust-runtime-contract';

/** Sole new adapter, triggered by observed browser48k; no parameter choices. */
export class Xc6Source48000 {
  private readonly ring=new Float32Array(128);
  private received=0;
  private nextOutput=0;
  private constructor(private readonly coefficients:Float32Array){}
  static async create(bytes:Uint8Array):Promise<Xc6Source48000>{
    bytes=new Uint8Array(bytes);
    const q=qualified['48000'];
    if(await sha256(new TextEncoder().encode(canonicalJson(q.identity)))!==q.identitySha256
      ||bytes.length!==244||await sha256(bytes)!==q.identity.coefficients.sha256)throw new Error('XC6_SOURCE_ADAPTER_IDENTITY_DRIFT');
    const d=new DataView(bytes.buffer);
    return new Xc6Source48000(Float32Array.from({length:61},(_,i)=>d.getFloat32(i*4,true)));
  }
  push(samples:Float32Array):{startSample:number;samples:Float32Array}{
    if(samples.some(v=>!Number.isFinite(v)))throw new Error('XC6_NONFINITE_CAPTURE');
    const startSample=this.nextOutput,out:number[]=[];
    for(const value of samples){
      this.ring[this.received%128]=value;this.received++;
      while(this.nextOutput*3+30<this.received){
        const coordinate=this.nextOutput*3+30;let sum=0;
        for(let n=Math.max(0,coordinate-60);n<=coordinate;n++)sum=Math.fround(sum+Math.fround(this.ring[n%128]*this.coefficients[coordinate-n]));
        out.push(sum);this.nextOutput++;
      }
    }
    return{startSample,samples:Float32Array.from(out)};
  }
  readonly firstFullyRealOutputIndex=10;
}
