import { prepare,proof,verify } from './audit.mjs';
import { replay } from './replay.mjs';
import { report,receipt } from './closeout.mjs';
const mode=process.argv[2];
if(mode==='prepare')await prepare();else if(mode==='proof')await proof();else if(mode==='replay')await replay();
else if(mode==='report')await report();else if(mode==='receipt')await receipt();
else if(mode==='verify'){await verify();console.log('ALLOWED_PRODUCTION_AND_IMMUTABLE_HISTORY_HASHES_EXACT');}
else throw Error('prepare/proof/replay/report/receipt/verify only; no acoustic pipeline commands');
