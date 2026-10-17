import * as protocol from './protocol.mjs';
import {runEngineering,runMusical} from '../qualification/continuous-regression.mjs';
if(process.argv[2]==='engineering')await runEngineering(protocol);
else if(process.argv[2]==='musical')await runMusical(protocol);
else throw Error('SELECT_ENGINEERING_OR_MUSICAL');
