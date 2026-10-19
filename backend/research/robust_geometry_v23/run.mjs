import { prepare,build,freeze,proof,rawProof,verify } from './control.mjs';
import { report,receipt } from './closeout.mjs';
import { OUT,save,now } from './io.mjs';
const mode=process.argv[2];
try{
  if(mode==='prepare')await prepare();else if(mode==='build')await build();else if(mode==='freeze')await freeze();
  else if(mode==='proof')await proof();else if(mode==='raw-proof')await rawProof();else if(mode==='report')await report();
  else if(mode==='receipt')await receipt();else if(mode==='verify'){await verify();console.log('FROZEN_PRODUCTION_AND_HISTORY_IDENTITIES_EXACT');}
  else throw Error('prepare/build/freeze/proof/raw-proof/report/receipt/verify only. Capture and Stage B are separate single-use entry points.');
}catch(error){
  if(['prepare','build','freeze','proof','raw-proof'].includes(mode))await save(OUT+'/control-failure.json',{failedAt:now(),mode,error:String(error.stack??error),
    failureClassification:mode==='prepare'?'ROBUST_V23_GEOMETRY_INPUT_RECONSTRUCTION_BLOCKED':mode==='raw-proof'?'ROBUST_V23_RAW_TENSOR_SEAL_BLOCKED':'ROBUST_V23_GEOMETRY_STUDY_INTEGRITY_BLOCKED',
    disposition:'ROBUST_V23_GEOMETRY_STUDY_INTEGRITY_BLOCKED',rerunAllowed:false});throw error;
}
