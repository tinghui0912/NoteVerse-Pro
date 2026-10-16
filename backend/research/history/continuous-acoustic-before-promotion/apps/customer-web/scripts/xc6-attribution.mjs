import path from 'node:path';
import { ROOT,WORK,REPORTS,load,newJson,fileId,PHASE } from './xc6-evidence.mjs';
const p=path.join(WORK,'diagnostics/reproduction.json'),r=await load(p);
const errors=r.diagnostics.rows.filter(e=>e.method==='Runtime.exceptionThrown'&&e.params.exceptionDetails.exception?.description?.includes('window is not defined'));
if(errors.length!==3||r.diagnostics.scripts.length!==3||r.diagnostics.scripts.some(s=>!s.relevantSource?.includes('Object.assign(window, { runXc5Smoke })')))throw new Error('ATTRIBUTION_NOT_ESTABLISHED');
const favicon=r.diagnostics.rows.find(e=>e.method==='Log.entryAdded'&&e.params.entry.url?.endsWith('/favicon.ico')&&e.params.entry.text.includes('403'));
if(!favicon)throw new Error('HTTP403_NOT_ATTRIBUTED');
await newJson(path.join(REPORTS,'phase9g_xc6_xc5_console_attribution_2026-10-16.json'),{
  phase:PHASE,reproduction:await fileId(p),remoteFreezeProof:r.proof,browser:r.browser,
  referenceErrors:errors.map(e=>({classification:'HARNESS_ONLY_DIAGNOSTIC_NON_BLOCKING',timestamp:e.timestamp,
    origin:e.origin,details:e.params.exceptionDetails,source:r.diagnostics.scripts.find(s=>s.origin===e.origin)})),
  sourceInterpretation:'Pinned ORT bundled ESM auxiliary worker creation re-imported the main smoke entry URL; that harness-only top-level window hook throws in a worker. No unguarded window access was found in the customer acoustic worker. New capture harness must use a guarded main-page hook and no main-thread reference inference bootstrap.',
  harnessSource:await fileId(path.join(ROOT,'apps/customer-web/scripts/xc5-smoke-entry.ts')),
  http403:{classification:'HARNESS_ONLY_DIAGNOSTIC_NON_BLOCKING',...favicon.params.entry,
    corroboratingServerRequest:r.serverRequests.find(q=>q.url==='/favicon.ico'),resolution:'New harness serves favicon204; unknown data routes remain denied.'},
  ortShapeWarnings:{classification:'DEPENDENCY_DIAGNOSTIC_NON_BLOCKING',
    interpretation:'Provider remained webgpu only. ORT explicitly permits shape-related CPU assignments; no automatic WASM-provider switch requested.'},
  runtimeSourceBugFound:false,xc5HistoricalReportsModified:false,
  reproductionActualSessionRunCount:r.result.actualSessionRunCount,
  noScientificAccuracyScoring:true,productionMicrophone:false});
