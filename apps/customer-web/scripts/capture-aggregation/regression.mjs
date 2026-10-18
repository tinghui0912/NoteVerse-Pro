import * as protocol from './protocol.mjs';
import {runEngineering,runMusical} from '../qualification/continuous-regression.mjs';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
for(const file of ['transport-stress.json','cold-start.json']){
 const result=JSON.parse(await readFile(path.join(protocol.paths().work,file),'utf8'));
 if(result.status!=='PASS')throw Error('TRANSPORT_GATE_NOT_PASS:'+file);
}
if(process.argv[2]==='musical')await runMusical(protocol);
else await runEngineering(protocol);
