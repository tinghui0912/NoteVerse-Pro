import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {ROOT,git,json} from './protocol.mjs';
const head=git('ls-remote','origin','refs/heads/codex/customer-web-delivery-boundary').split(/\s/)[0];
if(head!==git('rev-parse','HEAD'))throw Error('REMOTE_MOVED');
const c=execFileSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8'});
const token=c.split(/\r?\n/).find(x=>x.startsWith('password='))?.slice(9);
async function api(p){const r=await fetch('https://api.github.com/repos/tinghui0912/NoteVerse-Pro/'+p,{headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'}});if(!r.ok)throw Error('GITHUB_'+r.status);return r.json();}
const combined=await api(`commits/${head}/status`),runs=await api(`actions/runs?head_sha=${head}`);
const receipt={queriedAt:new Date().toISOString(),actualRemoteHead:head,combinedState:combined.state,statuses:combined.statuses,
 workflowRuns:runs.workflow_runs,interpretation:!combined.statuses.length&&!runs.workflow_runs.length?'NOT CI PASS':'SEE ACTUAL CHECK RESULTS',
 commitChain:git('log','--reverse','--format=%H %s','c8de147f819cf5bd971de581192b096ef7b6abb4..HEAD').split('\n')};
if(process.argv[2]==='final')console.log(JSON.stringify(receipt));
else {await json(path.join(ROOT,'backend/research/reports/fresh_strike_v2/github-receipt.json'),{githubReceipt:receipt});console.log(JSON.stringify(receipt));}
