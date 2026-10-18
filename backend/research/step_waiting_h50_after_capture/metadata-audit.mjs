import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {selectedOccurrenceAudit, otherRapidEvents} from './metadata.mjs';

const root = path.resolve(import.meta.dirname, '../../..'), startedAt = new Date().toISOString();
const base = 'backend/data/work/step_waiting_topology_v3/corpus-v4';
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = async file => {const bytes = await readFile(path.join(root, file)); return {path:file, bytes:bytes.length, sha256:hash(bytes)};};
const truth = JSON.parse(await readFile(path.join(root, base, 'truth.json'), 'utf8'));
const jobs = JSON.parse(await readFile(path.join(root, base, 'audio_only/jobs.json'), 'utf8'));
const rows = truth.cases.map(selectedOccurrenceAudit);
const existingQualifyingOccurrences = rows.filter(r => r.intendedContainsRapidSamePitch || r.selectedPair?.eligibleRapidSamePitchOrChord);
const otherOccurrences = truth.cases.flatMap(otherRapidEvents);
const git = (...args) => execFileSync('git', args, {cwd:root, encoding:'utf8'}).trim();
const productionDiff = git('diff', '--name-only', '9d257acbd799f23fdb928a8e9ae323c1449ed15a', '--', 'apps/customer-web/src', 'apps/customer-web/public', 'backend/app');
if (productionDiff) throw Error('PROTECTED_PRODUCTION_DIFF');
const report = {
  phase:'PRACTICE_STEP_WAITING_USER_H50_ACOUSTIC_ATTEMPT_QUALIFICATION_AFTER_CAPTURE_REPAIR',
  disposition:'STEP_WAITING_USER_PRODUCT_TOPOLOGY_NOT_ESTABLISHED',
  startingHead:'9d257acbd799f23fdb928a8e9ae323c1449ed15a',
  executionKind:'PRE_FREEZE_METADATA_ONLY_FEASIBILITY_AUDIT_NOT_ACOUSTIC_QUALIFICATION',
  startedAt, completedAt:new Date().toISOString(),
  fixedMembership:{caseSlots:rows.length, rateJobs:jobs.jobs.length, rates:[44100,48000],
    independentRecordings:new Set(rows.map(r => r.recordingId)).size,
    physicalOccurrences:new Set(truth.cases.map(c => `${c.source.recordingId}:${c.intendedTime ?? c.arm}`)).size},
  manifests:await Promise.all([base+'/truth.json', base+'/audio_only/jobs.json', 'backend/research/step_waiting_topology_v3/contract.json'].map(identity)),
  userClarification:'rapid_retrigger requires the same pitch or the same chord to be struck again; a fast different-pitch gesture is insufficient.',
  spacingProvenance:'Existing frozen rapid_not_ready metadata rule is 200..250ms; no new acoustic threshold is introduced.',
  selectedOccurrences:rows, existingQualifyingOccurrences,
  otherRapidOccurrencesInFixedSlices:otherOccurrences,
  missingContract:'A preselected intended same-pitch/same-chord rapid re-strike occurrence in the fixed case manifest. Warmup/arming can move readiness before an existing event but cannot change its pitch identity or internal spacing. Choosing a different earlier occurrence would change the fixed intended event rather than repair replay topology.',
  notClaimed:'The complete fixed PCM slices do contain other rapid same-pitch events. This report does not claim the source recordings lack such material.',
  forbiddenRemediesNotTaken:['replace intended occurrence','replace corpus case','change H','tune decoder','alter source waveform/timestamps','count different-pitch fast pair as same-pitch retrigger'],
  qualification:{freezeCommit:null, freezeSha256:null, qualificationExecutionProof:null,
    staticVerification:'NOT_STARTED_NO_ACCEPTANCE_FREEZE', continuousRegression:'NOT_STARTED',
    stageA:'NOT_STARTED', acousticSeal:null, stageB:'NOT_STARTED',
    safetyCounters:null, usabilityMetrics:null, latencyMetrics:null,
    actualNeuralRuns:0, invalidatedNeuralRuns:0},
  preflightDspReceipt:await identity('backend/data/work/step_waiting_h50_after_capture/preflight/input-preservation.json'),
  productionDiff, capabilities:{Continuous:'MODEL_NOT_VALIDATED',STEP:'ATTEMPT_ANALYZER_NOT_VALIDATED',productionMicrophone:false,D4:false},
  historicalEvidenceModified:false, newDatasetDownloads:0,
  classification:'QUALIFICATION_TOPOLOGY_MISSING_EVIDENCE_NOT_ACOUSTIC_MODEL_SAFETY_FAILURE'
};
const out = path.join(root, 'backend/research/reports/step_waiting_h50_after_capture');
await mkdir(out, {recursive:true});
await writeFile(path.join(out, 'preflight.json'), JSON.stringify(report,null,2)+'\n', {flag:'wx'});
console.log(JSON.stringify({disposition:report.disposition, qualifyingSelectedOccurrences:existingQualifyingOccurrences.length,
  otherRapidContextOccurrences:otherOccurrences.length, actualNeuralRuns:0, report:path.relative(root,path.join(out,'preflight.json'))}));
