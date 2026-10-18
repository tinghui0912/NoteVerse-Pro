import * as protocol from './protocol.mjs';
import {runEngineering,runMusical} from '../qualification/continuous-regression.mjs';
if(process.argv[2]==='musical')await runMusical(protocol);
else await runEngineering(protocol);
