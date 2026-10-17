import {runEngineering,runMusical} from '../qualification/continuous-regression.mjs';
import * as protocol from './protocol.mjs';
if(process.argv[2]==='engineering')await runEngineering(protocol);
else if(process.argv[2]==='musical')await runMusical(protocol);
else throw Error('EXPECTED engineering OR musical');
