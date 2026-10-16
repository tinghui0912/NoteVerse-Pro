import path from 'node:path';
import { ROOT,WORK,PHASE,START,CORE,git,checkCore,sourceRows,fileId,newJson,freezePath,hash,canonical } from './xc6-evidence.mjs';
const stage=process.argv[2];
if(!['capture_probe','capture_integration'].includes(stage))throw new Error('XC6_FREEZE_STAGE');
checkCore();if(git('status','--porcelain','--untracked-files=no'))throw new Error('COMMIT_SOURCE_FIRST');
const f={phase:PHASE,stage,startingRemoteHead:START,implementationCommit:git('rev-parse','HEAD'),
  xc4CoreIdentitySha256:CORE,sources:await sourceRows(),createdAt:new Date().toISOString(),productionMicrophone:false,
  assets:[await fileId(path.join(WORK,'fake-device.wav')),await fileId(path.join(ROOT,'backend/research/xc6_prepare_fixture.py'))],
  plan:stage==='capture_probe'?{neuralInferenceCount:0,realDevice:'One ordinary permission request, bounded12seconds; no grant override. Metadata only, no PCM persisted.',
    fakeDevice:'One browser-faithful metadata observation, default AudioContext rate, no forced sample rate. Conditional48k implementation forbidden until observed.',
    durationMs:1200}: {kind:'One fake-media end-to-end smoke; no direct PCM injection after AudioWorklet.',ownedMs:600,futureMs:170,minimumWindows:2},
  xc5CaveatPreserved:true};
f.freezeCanonicalSha256=hash(canonical(f));await newJson(freezePath(stage),f);
