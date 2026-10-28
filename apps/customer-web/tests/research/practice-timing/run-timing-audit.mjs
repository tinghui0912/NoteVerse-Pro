import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
const args=process.argv.slice(2);
if(args.length&&(args.length!==2||args[0]!=='--output'||!args[1]))throw Error('TIMING_AUDIT_ARGUMENTS_INVALID');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const server=await createServer({root,configFile:false,logLevel:'error',resolve:{alias:{'@':path.join(root,'src')}},server:{middlewareMode:true,watch:null,hmr:false}});
try {
  const {runTimingSemanticsAudit,assertTimingSemanticsAudit}=await server.ssrLoadModule('/tests/research/practice-timing/timing-semantics-audit.ts');
  const report=runTimingSemanticsAudit();assertTimingSemanticsAudit(report);
  console.table(report.comparison);
  console.log('Proof:',JSON.stringify(report.proof));
  console.table(report.tempoScaling.filter(x=>x.offsetBeats===0.2).map(x=>{
    const current=x.outcomes[0];return {bpm:x.bpm,offsetBeats:x.offsetBeats,states:current.targets.map(t=>t.state).join('/'),
      claimants:current.events.map(o=>o.ownershipClaimants).join('/'),latencyMs:current.targets[0].latencyMs,latencyLocalBeats:current.targets[0].latencyLocalBeats};
  }));
  const output=path.resolve(args[1]??'artifacts/practice-timing/timing_semantics_audit.json');
  await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report)+'\n');
  console.log(`Unchanged production baseline: ${report.baselineCaseCount} cases; candidates: ${report.candidateIds.length}; adversarial cases: ${report.adversarial.length}.`);
  console.log('No candidate is a production recommendation; no learner/hardware qualification was performed.');
  console.log(`Report: ${output}`);
} finally {await server.close();}
