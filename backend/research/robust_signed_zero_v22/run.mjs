import { prepare, proof, verify, scope } from './evidence.mjs';
import { evaluate } from './evaluate.mjs';
import { report, receipt } from './closeout.mjs';
import { OUT, save, now, execution } from './io.mjs';

const command=process.argv[2];
try {
  if(command==='prepare') await prepare();
  else if(command==='proof') await proof();
  else if(command==='evaluate') await evaluate();
  else if(command==='report') await report();
  else if(command==='receipt') await receipt();
  else if(command==='verify') console.log(JSON.stringify({verified:!!await verify(),changed:await scope(),execution}));
  else throw Error('Only prepare/proof/evaluate/report/receipt/verify. No acoustic/product pipeline commands.');
} catch(error) {
  if(command==='prepare'||command==='proof') await save(OUT+'/pre-evaluation-failure.json',{failedAt:now(),command,
    failure:String(error.stack??error),execution,disposition:'ROBUST_V22_EVIDENCE_INTEGRITY_BLOCKED',realEvaluationStarted:false});
  throw error;
}
