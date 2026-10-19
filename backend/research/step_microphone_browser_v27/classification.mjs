export const INTEGRITY='STEP_V27_BROWSER_EXECUTION_INTEGRITY_BLOCKED';
export const PRODUCT='STEP_V27_BROWSER_RESOURCE_GRAPH_PRODUCTION_DEFECT_FOUND';
export const NO_EVIDENCE='STEP_V27_BROWSER_RESOURCE_GRAPH_EVIDENCE_CONSUMPTION_NOT_EXERCISED';
export const SUCCESS='STEP_V27_BROWSER_CORE_GRAPH_ESTABLISHED_FAKE_MEDIA_ASSET_DELIVERY_AND_PHYSICAL_DEVICE_NOT_QUALIFIED';

/** Classification is causal evidence evaluation, not a proxy for "Worker constructed". */
export function classifyFailure({message,trace,environmentValid,networkValid=true}){
  if(!environmentValid||!networkValid)return {disposition:INTEGRITY,reason:'ENVIRONMENT_OR_NETWORK_NOT_ESTABLISHED'};
  if(message.includes('REAL_EVIDENCE_CONSUMPTION_NOT_EXERCISED'))return {disposition:NO_EVIDENCE,reason:'REAL_ACOUSTIC_EVIDENCE_COVERAGE_ABSENT_NOT_A_RECOGNITION_QUALITY_CLAIM'};
  if(message.includes('APPLICATION_ROOT_WATCHER_DID_NOT_OBSERVE_STOPPED_ROOT'))return {disposition:INTEGRITY,
    reason:'ACTUAL_ROOT_STOP_DID_NOT_PRODUCE_REQUIRED_WATCHER_CALLBACK_FAKE_MEDIA_LOSS_STIMULUS_COVERAGE_MISSING',
    noSyntheticEvent:true,notAutomaticallyAProductDefect:true};
  const running=trace?.initial?.input?.resourceState==='AVAILABLE'&&trace?.modelReceipt?.actualSessionLoadCount===1
    &&trace?.modelReceipt?.executionProvider==='webgpu'&&trace?.publications?.length>0;
  const invariants=['RETIREMENT_NOT_PHYSICAL_CAPTURE','BOUNDARY_SOURCE_MAPPING','MICROPHONE_CLOCK_NOT_AUDIO_CONTEXT',
    'GENERATION_NOT_REARM_OWNED','OLD_SOURCE_ATTEMPT_OPEN','NON_READY_OR_REJECTED_ACOUSTIC_OPEN','EARLY_DOMAIN_PROGRESSION',
    'INPUT_DISPOSE_STOPPED_BORROWED_ROOT','INPUT_DISPOSE_CLOSED_BORROWED_CONTEXT','ANALYSIS_CLONE_NOT_ENDED',
    'OBSERVATION_TWO_ATTEMPTS','FAILURE_NOT_ONCE_OR_NOT_CLEAN','RUNTIME_SOURCE_POLICY_INCONSISTENCY'];
  const invariant=invariants.find(v=>message.includes(v));
  if(running&&invariant)return {disposition:PRODUCT,reason:'RUNNING_REAL_PRODUCTION_GRAPH_VIOLATED_FROZEN_INVARIANT',
    invariant,causalWitness:{initial:trace.initial,modelReceipt:trace.modelReceipt,failureState:trace.failureState,
      afterInputCleanup:trace.afterInputCleanup,finalCounts:trace.finalCounts}};
  const productError=trace?.failures?.find(f=>/CAPTURE_CHRONOLOGY_VIOLATION|CAPTURE_CONTEXT_FRAME_GAP|STEP_ACOUSTIC_MUTATED_OBSERVATION|ACOUSTIC_BACKPRESSURE_LIMIT_EXCEEDED|STEP_MICROPHONE_RETIREMENT_INVALID/.test(f.message));
  if(running&&productError)return {disposition:PRODUCT,reason:'EXACT_TERMINAL_PRODUCTION_FAILURE_AFTER_VALID_REAL_GRAPH',
    causalWitness:{error:productError,initial:trace.initial,failureState:trace.failureState,modelReceipt:trace.modelReceipt}};
  return {disposition:INTEGRITY,reason:'TOOL_ENVIRONMENT_INSTRUMENTATION_OR_UNRESOLVED_CAUSALITY_NOT_A_PRODUCTION_DEFECT',
    productionGraphRunning:running,resourceCreationAloneIsNotProof:true};
}
