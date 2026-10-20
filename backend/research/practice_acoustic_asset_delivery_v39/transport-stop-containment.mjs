import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { captureProcess, sanitizedProcessResult } from './process-result.mjs';
import { save, now, OUT, BLOCKED } from './io.mjs';

// Additive containment only. Never restart a command or alter qualification sources.
const childPid = process.argv[2];
assert.match(childPid ?? '', /^[0-9]+$/);
if (!existsSync(OUT + '/first-failure.json')) {
  save('first-failure.json', { disposition: BLOCKED, firstFailedGate: 'PREFLIGHT_ORCHESTRATOR_RESULT_TRANSPORT',
    at: now(), safeCode: 'MCP_TOOLS_CALL_TIMEOUT_AFTER_300_SECONDS', errorClass: 'ToolTransportTimeout',
    resultProcessWasStillPending: true, noRetry: true, productionDefectEstablished: false,
    browserLaunches: 0, modelAccessRequests: 0, ossRequests: 0, modelSessions: 0, inferenceRuns: 0 });
}
const result = captureProcess('taskkill', ['/PID', childPid, '/T', '/F']);
save('transport-stop-containment.json', { at: now(), purpose: 'Stop only observed child command tree of the pending V39 preflight after permanent transport failure',
  selectedOwnedChildPid: Number(childPid), failedCommandRepeated: false, apiRuntimeContainerChanged: false,
  commandResult: sanitizedProcessResult(result, 'OWNED_V39_PREFLIGHT_CHILD_TREE_CONTAINMENT') });
console.log(JSON.stringify({ containmentExitCode: result.exitCode, qualificationPermanentlyStopped: true }));
