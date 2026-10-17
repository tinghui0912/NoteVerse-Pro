import {readFileSync,writeFileSync} from 'node:fs';
for(const name of ['protocol.mjs','verify.mjs','controller-browser.mjs','musical-browser.mjs','score.mjs','report.mjs']) {
 let text=readFileSync('scripts/step-domain/'+name,'utf8')
  .replaceAll('step_domain_v2','step_boundary_v1').replaceAll('step_domain','step_boundary')
  .replaceAll('9c97dfb021cb98930e71391a6e203d9ef176bd75','4901be2dc86c7a57eb1eb323f98293de809d0b7c')
  .replaceAll('PRACTICE_STEP_ONE_TARGET_ONE_ATTEMPT_DOMAIN_AND_CONTROLLER_CLEAN_BREAK','PRACTICE_STEP_EXCLUSIVE_ATTEMPT_BOUNDARY_REPAIR')
  .replaceAll('PRACTICE_STEP_ONE_TARGET_ONE_ATTEMPT_DOMAIN_CONTROLLER_READY_MICROPHONE_DISABLED','PRACTICE_STEP_ONE_TARGET_ONE_ATTEMPT_DOMAIN_CONTROLLER_READY_MICROPHONE_DISABLED_BOUNDARY_REPAIRED')
  .replaceAll('PRACTICE_STEP_ONE_TARGET_ONE_ATTEMPT_DOMAIN_CONTROLLER_BLOCKED','PRACTICE_STEP_EXCLUSIVE_ATTEMPT_BOUNDARY_REPAIR_BLOCKED');
 writeFileSync('scripts/step-boundary/'+name,text);
}
