import { StepMicrophoneInput, type StepMicrophoneRetirementBoundary } from '../../../apps/customer-web/src/lib/practice/step/step-microphone-input';
import { browserStepMicrophonePlatform } from '../../../apps/customer-web/src/lib/practice/step/step-microphone-platform';
import { StepPracticeRuntime } from '../../../apps/customer-web/src/lib/practice/local-core/step-runtime';
import type { PracticeScoreArtifact } from '../../../apps/customer-web/src/lib/practice/local-core/artifact';
import type { StepAttemptIdentity } from '../../../apps/customer-web/src/lib/practice/local-core/step-attempt';
import { SourceAnalysisRuntime } from '../../../apps/customer-web/src/lib/practice/acoustic/runtime/source-analysis-runtime';
import { SourceChronology } from '../../../apps/customer-web/src/lib/practice/acoustic/source/source-chronology';
import { StepAcousticAttemptAssembler } from '../../../apps/customer-web/src/lib/practice/step/step-acoustic-attempt-assembler';
import { BrowserAcousticCapture } from '../../../apps/customer-web/src/lib/practice/acoustic/source/capture';
import { watchMicrophoneInfrastructure } from '../../../apps/customer-web/src/lib/practice/acoustic/source/microphone-infrastructure';
import fixture from '../../../apps/customer-web/src/lib/practice/local-core/__fixtures__/canonical-practice-score-artifact.json';
import plan from './contract.json';

type Cell = { id: string; rate: number; scenario: string };
const host = globalThis as typeof globalThis & { runV26?: (cell: Cell) => Promise<unknown>; v26Trace?: Record<string, unknown> };
const demand = (value: unknown, code: string): void => { if (!value) throw new Error(code); };
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const deadline = async <T>(promise: Promise<T>, ms: number, code: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(code)), ms); })]); }
  finally { clearTimeout(timer); }
};
const unique = (a: readonly string[]) => [...new Set(a)].sort();

host.runV26 = async cell => {
  const trace: Record<string, any> = { cell, stage: 'BEGIN', media: 'REAL_BROWSER_FAKE_MEDIA_SOURCE', realDevice: false,
    assetDelivery: plan.assetDelivery, counts: { rootStreams:0, analysisClones:0, context:0, workerOwners:0, loadAttempts:0, loadSuccesses:0,
      runAttempts:0, runSuccesses:0, runFailures:0, workerDisposeCalls:0, captureConnections:0, captureStopCalls:0, captureStopTransitions:0,
      sourceRuntimes:0, chronologyInstances:0, assemblerInstances:0, sourceDisposals:0 },
    chronology: [], publications: [], runReceipts: [], attempts: [], boundaries: [], infrastructure: [], failures: [], applicationFailures: [],
    teardown: [], mute:'NOT_EVALUATED_BROWSER_FAKE_MEDIA_LIMITATION', fixedCooldownSelected:false, syntheticPublications:0 };
  host.v26Trace = trace;
  let input: StepMicrophoneInput<StepAttemptIdentity> | null = null, domain: StepPracticeRuntime | null = null;
  let context: AudioContext | null = null, root: MediaStream | null = null, clone: MediaStream | null = null;
  let watcherDetach = () => {}, applicationFailure: string | null = null, observedFailure: Error | null = null;
  let pendingCommit = false, commitScheduled = false, holdForPublication: number | null = null;
  const abort = new AbortController(), chronologyOwners = new Set<SourceChronology>(), assemblerOwners = new Set<object>();
  const originals = { create: SourceAnalysisRuntime.create, chronology: SourceChronology.prototype.accept,
    accept: StepAcousticAttemptAssembler.prototype.accept, arm: StepAcousticAttemptAssembler.prototype.acceptInputAfter,
    capture: BrowserAcousticCapture.connect, sourceDispose: SourceAnalysisRuntime.prototype.dispose };
  const appFail = (reason: string) => {
    if (applicationFailure) return;
    applicationFailure = reason; trace.applicationFailures.push({ reason, contextTime: context?.currentTime });
    abort.abort(); void input?.dispose().catch(e => trace.failures.push({ phase:'application-dispose', message:String(e) }));
  };
  const valid = () => { if (observedFailure || applicationFailure) throw observedFailure ?? new Error(applicationFailure!); };
  const state = () => ({ input: input?.snapshot(), domain: domain?.snapshot(), contextTime: context?.currentTime });
  const commit = (boundary?: StepMicrophoneRetirementBoundary, initial = false) => {
    valid(); demand(input && domain && context, 'GRAPH_NOT_ATTACHED');
    const b = boundary ?? input!.retirementBoundary(), before = state();
    demand(b.capturedThroughSourceSample === before.input!.capture!.capturedThroughSourceSample, 'RETIREMENT_NOT_PHYSICAL_CAPTURE');
    demand(b.sessionTime.sampleIndex === b.capturedThroughSourceSample, 'BOUNDARY_SOURCE_MAPPING');
    demand(input!.clock.nowMs() === context!.currentTime * 1000, 'MICROPHONE_CLOCK_NOT_AUDIO_CONTEXT');
    if (initial) domain!.acceptInputAfter(b.sessionTime); else {
      demand(before.domain!.step.attemptState === 'POST_VERDICT', 'REARM_WITHOUT_POST_VERDICT'); domain!.rearm(b.sessionTime);
    }
    if (domain!.snapshot().runtimeStatus === 'ACTIVE') input!.arm(b);
    const after = state();
    demand(after.domain!.step.targetGeneration === before.domain!.step.targetGeneration +
      (!initial && before.domain!.step.attempts.at(-1)?.verdict === 'MATCH' ? 1 : 0), 'GENERATION_NOT_REARM_OWNED');
    trace.boundaries.push({ initial, boundary:b, before, after, sameSynchronousCallStack:true });
    pendingCommit = false;
  };
  const scheduleCommit = () => {
    if (!pendingCommit || commitScheduled || applicationFailure || observedFailure) return;
    if (holdForPublication !== null && trace.publications.length < holdForPublication) return;
    commitScheduled = true;
    queueMicrotask(() => {
      commitScheduled = false;
      try { holdForPublication = null; commit(); } catch (error) { observedFailure = error as Error; appFail(String(error)); }
    });
  };

  SourceChronology.prototype.accept = function(chunk) {
    originals.chronology.call(this, chunk); chronologyOwners.add(this);
    trace.counts.chronologyInstances = chronologyOwners.size;
    trace.chronology.push({ sequence:chunk.sequence, start:chunk.sourceStartSampleIndex, end:chunk.sourceEndSampleIndex,
      rate:chunk.sourceSampleRateHz, origin:chunk.audioContextStartFrame-chunk.sourceStartSampleIndex, count:chunk.samples.length });
  };
  StepAcousticAttemptAssembler.prototype.accept = function(p) {
    assemblerOwners.add(this); trace.counts.assemblerInstances = assemblerOwners.size;
    const returned = originals.accept.call(this, p);
    if (returned) trace.lastSealedGesture = returned;
    return returned;
  };
  StepAcousticAttemptAssembler.prototype.acceptInputAfter = function(sample) {
    assemblerOwners.add(this); trace.counts.assemblerInstances = assemblerOwners.size; return originals.arm.call(this, sample);
  };
  SourceAnalysisRuntime.create = async options => {
    trace.counts.sourceRuntimes++;
    return originals.create.call(SourceAnalysisRuntime, { ...options, onPublication: p => {
      trace.publications.push(p); options.onPublication(p); scheduleCommit();
    } });
  };
  SourceAnalysisRuntime.prototype.dispose = async function() {
    trace.counts.sourceDisposals++; return originals.sourceDispose.call(this);
  };
  BrowserAcousticCapture.connect = async options => {
    trace.counts.captureConnections++;
    const capture = await originals.capture.call(BrowserAcousticCapture, options), stop = capture.stop.bind(capture);
    capture.stop = () => { trace.counts.captureStopCalls++;
      if (!(capture as unknown as { stopped:boolean }).stopped) trace.counts.captureStopTransitions++;
      stop();
    };
    return capture;
  };
  try {
    context = new AudioContext({ sampleRate:cell.rate }); trace.counts.context++;
    await context.resume(); demand(context.sampleRate === cell.rate && context.state === 'running', 'AUDIO_CONTEXT_RATE_OR_STATE');
    trace.stage = 'GET_USER_MEDIA';
    root = await navigator.mediaDevices.getUserMedia({ video:false, audio:{ echoCancellation:false, noiseSuppression:false, autoGainControl:false } });
    trace.counts.rootStreams++;
    trace.mediaSettings = root.getAudioTracks().map(t => ({ settings:t.getSettings(), readyState:t.readyState, muted:t.muted, label:t.label }));
    const originalClone = root.clone.bind(root);
    root.clone = () => { trace.counts.analysisClones++; clone = originalClone(); return clone; };
    watcherDetach = watchMicrophoneInfrastructure(root, context, code => {
      trace.infrastructure.push({ code, state:context!.state, tracks:root!.getAudioTracks().map(t => ({ readyState:t.readyState,muted:t.muted })),
        input:input?.snapshot(), atContextTime:context!.currentTime }); appFail(code);
    });
    const platform = { ...browserStepMicrophonePlatform,
      modelUrl: async () => new URL('/model.onnx', location.href).href,
      createWorker: () => {
        trace.counts.workerOwners++; const real = browserStepMicrophonePlatform.createWorker();
        return {
          onFailure: real.onFailure!.bind(real),
          load: async (url:string) => { trace.counts.loadAttempts++; const receipt = await real.load(url);
            trace.counts.loadSuccesses++; trace.modelReceipt = receipt; return receipt; },
          run: async (value: Parameters<typeof real.run>[0]) => {
            demand(++trace.counts.runAttempts <= plan.executionBudget.maximumRunAttemptsPerCell, 'V26_RUN_BUDGET_EXCEEDED');
            try { const result = await real.run(value); trace.counts.runSuccesses++;
              trace.runReceipts.push({ window:value.window, ...result });
              demand(result.actualSessionRunCount === trace.counts.runSuccesses, 'ACTUAL_MODEL_RUN_SEQUENCE'); return result;
            } catch (error) { trace.counts.runFailures++; throw error; }
          },
          dispose: async () => { trace.counts.workerDisposeCalls++; await real.dispose(); },
        };
      },
    };
    input = new StepMicrophoneInput(platform, {
      open: time => {
        demand(time.sampleIndex! > input!.snapshot().retiredThroughSourceSample, 'OLD_SOURCE_ATTEMPT_OPEN');
        const before = domain!.snapshot(), id = domain!.openAttempt(time);
        demand(id && before.step.attemptState === 'READY', 'NON_READY_OR_REJECTED_ACOUSTIC_OPEN');
        trace.lastOpen = { time, before, identity:id }; return id;
      },
      complete: (identity, evidence) => {
        demand(evidence.kind === 'EVIDENCE', 'EXTERNAL_RETRY_NOT_ALLOWED');
        const before = domain!.snapshot(), expected = domain!.currentTarget()!.attackPitches;
        demand(domain!.analyzeAttempt(identity), 'ACTUAL_RUNTIME_ANALYZE_FAILED');
        const result = domain!.completeAttempt(identity, evidence);
        demand(result.kind === 'FINALIZED', 'ACTUAL_RUNTIME_COMPLETE_FAILED');
        if (result.kind !== 'FINALIZED' || evidence.kind !== 'EVIDENCE') throw new Error('EVIDENCE_FINALIZATION_REQUIRED');
        const after = domain!.snapshot();
        // Assertion only AFTER the production runtime has independently finalized ordinary EVIDENCE.
        const o = unique(evidence.observedAttackPitches), e = unique(expected);
        const oracle = JSON.stringify(o) === JSON.stringify(e) ? 'MATCH' : e.every(p => o.includes(p)) ? 'RETRY' : 'MISMATCH';
        demand(result.record.verdict === oracle, 'RUNTIME_SOURCE_POLICY_INCONSISTENCY');
        demand(after.step.attemptState === 'POST_VERDICT' && after.step.currentIndex === before.step.currentIndex
          && after.step.targetGeneration === before.step.targetGeneration && after.runtimeStatus === 'ACTIVE', 'EARLY_DOMAIN_PROGRESSION');
        trace.attempts.push({ identity,evidence,record:result.record,expected,before,after,oracleAssertionAfterRuntime:true });
        pendingCommit = true;
        if (cell.scenario === 'normal' && trace.attempts.length === 1) holdForPublication = trace.publications.length + 1;
        scheduleCommit();
      },
      failure: error => { trace.failures.push({ message:error.message, input:input?.snapshot() }); appFail(error.message); },
    });
    trace.stage = 'INPUT_START';
    const pending = input.start({ context,stream:root,localSessionId:cell.id,sourceDomainId:cell.id+':capture' }, abort.signal);
    const base = fixture as PracticeScoreArtifact;
    const artifact: PracticeScoreArtifact = { ...base,
      expectedPracticeGroups: plan.targets.map((pitches,index) => { const g = base.expectedPracticeGroups[index % base.expectedPracticeGroups.length];
        return { ...g, groupId:`v26:g:${index}`, pitches,
          strikeTargets:pitches.map((pitch,j) => ({ ...g.strikeTargets[0],strikeId:`v26:g:${index}:s:${j}`,pitch })) }; }),
      practiceAttackSteps: plan.targets.map((pitches,index) => { const s = base.practiceAttackSteps[index % base.practiceAttackSteps.length];
        return { ...s,stepId:`v26:step:${index}`,groupId:`v26:g:${index}`,
          attackTargets:pitches.map((pitch,j) => ({ ...s.attackTargets[0],strikeId:`v26:g:${index}:s:${j}`,pitch })),continuation:[] }; }) };
    domain = new StepPracticeRuntime({ artifact,scope:{kind:'FULL'},inputSource:'MICROPHONE',clock:input.clock,
      localSessionId:cell.id,metadataClock:{nowEpochMs:()=>Date.now()} });
    domain.setInputUnavailable();
    const boundary = await deadline(pending, plan.deadlines.startMs, 'INPUT_START_TIMEOUT');
    trace.stage = 'AVAILABLE'; trace.initial = state();
    demand(trace.initial.input.resourceState === 'AVAILABLE' && trace.initial.input.assembler.phase === 'BLOCKED'
      && trace.initial.input.analysis.counts.regionsStarted === 1 && !domain.canAcceptAttempt, 'INITIAL_READINESS_GRAPH');
    commit(boundary,true); trace.stage = 'RUNNING';
    const started = context.currentTime;
    if (cell.scenario === 'normal') {
      while (context.currentTime-started < plan.normalObservationSeconds && !domain.isCompleted) { valid(); await sleep(20); }
      valid(); demand(trace.publications.length > 0 && trace.attempts.length > 0 && trace.boundaries.length > 1, 'REAL_EVIDENCE_CONSUMPTION_NOT_EXERCISED');
    } else {
      await deadline((async () => { while (trace.publications.length < 2) { valid(); await sleep(20); } })(), plan.deadlines.evidenceMs, 'REAL_PUBLICATIONS_NOT_EXERCISED');
      trace.beforeInfrastructureLoss = state();
      if (cell.scenario === 'context-loss') {
        trace.stage = 'CONTEXT_INTERRUPTION'; await context.suspend();
      } else {
        trace.stage = 'ROOT_TRACK_STOP'; root.getAudioTracks()[0].stop();
        trace.rootImmediatelyAfterStop = root.getAudioTracks().map(t => ({ readyState:t.readyState,muted:t.muted }));
      }
      const end = Date.now()+plan.deadlines.sourceLossMs;
      while (!applicationFailure && Date.now()<end) await sleep(20);
      trace.afterInfrastructureLoss = state();
      demand(applicationFailure && trace.infrastructure.length > 0, cell.scenario === 'root-loss'
        ? 'APPLICATION_ROOT_WATCHER_DID_NOT_OBSERVE_STOPPED_ROOT' : 'APPLICATION_CONTEXT_WATCHER_DID_NOT_TERMINATE');
      await deadline(input.dispose(), plan.deadlines.cleanupMs, 'FAILURE_CLEANUP_TIMEOUT');
      demand(trace.applicationFailures.length === 1 && trace.counts.workerDisposeCalls === 1 && clone!.getTracks().every(t => t.readyState === 'ended'), 'FAILURE_NOT_ONCE_OR_NOT_CLEAN');
    }
    trace.beforeInputDispose = state();
    watcherDetach(); watcherDetach = () => {};
    await deadline(input.dispose(), plan.deadlines.cleanupMs, 'INPUT_DISPOSE_TIMEOUT');
    trace.teardown.push({ kind:'INPUT_DISPOSE', root:root.getTracks().map(t=>t.readyState),clone:clone!.getTracks().map(t=>t.readyState),contextState:context.state,input:input.snapshot() });
    if (cell.scenario !== 'root-loss') demand(root.getTracks().every(t=>t.readyState==='live'), 'INPUT_DISPOSE_STOPPED_BORROWED_ROOT');
    if (cell.scenario === 'normal') demand(context.state==='running', 'INPUT_DISPOSE_CLOSED_BORROWED_CONTEXT');
    demand(clone!.getTracks().every(t=>t.readyState==='ended'), 'ANALYSIS_CLONE_NOT_ENDED');
    demand(trace.counts.workerOwners===1 && trace.counts.loadAttempts===1 && trace.counts.loadSuccesses===1
      && trace.counts.workerDisposeCalls===1 && trace.counts.sourceRuntimes===1 && trace.counts.analysisClones===1
      && trace.counts.chronologyInstances===1 && trace.counts.assemblerInstances===1 && trace.counts.captureConnections===1
      && input.snapshot().analysis?.counts.regionsStarted===1, 'PERSISTENT_GRAPH_COUNTS');
    demand(trace.modelReceipt.actualSessionLoadCount===1 && trace.modelReceipt.ortWebVersion==='1.20.1'
      && trace.modelReceipt.executionProvider==='webgpu' && trace.modelReceipt.automaticFallback===false
      && trace.modelReceipt.modelSha256===plan.currentDefaults.modelSHA256, 'REAL_MODEL_IDENTITY_PROVIDER');
    const origins = new Set(trace.chronology.map((c:any)=>c.origin)); demand(origins.size===1, 'CAPTURE_ORIGIN_CHANGED');
    const ids = new Set<string>();
    for (const attempt of trace.attempts) {
      const start=attempt.identity.attemptStartSessionTime.sampleIndex,end=attempt.evidence.captureEndSessionTime.sampleIndex;
      for (const p of trace.publications) for (const o of p.observations) if(o.sourceEventSample>=start&&o.sourceEventSample<end) {
        demand(!ids.has(o.observationId),'OBSERVATION_TWO_ATTEMPTS');ids.add(o.observationId);
      }
    }
    trace.stage='COMPLETE';trace.status='PASS';
  } catch (error) {
    trace.status='FAILED';trace.error=String((error as Error).stack??error);trace.failureState=state();
  } finally {
    watcherDetach();
    if (input) { try { await deadline(input.dispose(),plan.deadlines.cleanupMs,'FINAL_CLEANUP_TIMEOUT'); } catch(error) {trace.cleanupError=String(error);} }
    trace.afterInputCleanup={...state(),root:root?.getTracks().map(t=>t.readyState),clone:(clone as MediaStream|null)?.getTracks().map(t=>t.readyState)};
    if (root) for(const track of root.getTracks())track.stop();
    if (context && context.state!=='closed') await context.close();
    trace.teardown.push({kind:'APPLICATION_SESSION_DISPOSE',root:root?.getTracks().map(t=>t.readyState),contextState:context?.state});
    SourceAnalysisRuntime.create=originals.create;SourceAnalysisRuntime.prototype.dispose=originals.sourceDispose;
    SourceChronology.prototype.accept=originals.chronology;StepAcousticAttemptAssembler.prototype.accept=originals.accept;
    StepAcousticAttemptAssembler.prototype.acceptInputAfter=originals.arm;BrowserAcousticCapture.connect=originals.capture;
    trace.finalCounts={...trace.counts};trace.finalDomain=domain?.snapshot();
    trace.sameTargetAcceptance=trace.attempts.some((a:any,i:number)=>i>0&&JSON.stringify(a.expected)===JSON.stringify(trace.attempts[i-1].expected))
      ? 'REAL_DISTINCT_SOURCE_ATTEMPTS_OBSERVED' : 'SECOND_IDENTICAL_TARGET_ACCEPTANCE_NOT_EXERCISED';
  }
  return trace;
};
