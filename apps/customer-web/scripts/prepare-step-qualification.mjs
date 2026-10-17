import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const target = 'scripts/step-domain';
mkdirSync(target,{recursive:true});
for (const name of ['verify.mjs','controller-browser.mjs','musical-browser.mjs','score.mjs']) {
  const source = readFileSync('scripts/shared-acoustic/'+name,'utf8')
    .replaceAll('shared_acoustic_v4','step_domain_v2')
    .replaceAll('tests.test_continuous_model_asset','tests.test_practice_acoustic_model_asset');
  writeFileSync(target+'/'+name,source);
}
