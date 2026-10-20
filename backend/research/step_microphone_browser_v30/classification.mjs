import { load, DIR } from './io.mjs';
const contract = await load(DIR + '/contract.json');
export const INTEGRITY = contract.integrityDisposition, SUCCESS = contract.successDisposition;
export function classifyFailure({ message, trace, environmentValid, networkValid = true }) {
  const running = environmentValid && networkValid && trace?.initial?.input?.resourceState === 'AVAILABLE'
    && trace?.modelReceipt?.actualSessionLoadCount === 1 && trace?.publications?.length > 0;
  const codes = ['RETIREMENT_NOT_PHYSICAL_CAPTURE', 'OLD_SOURCE_ATTEMPT_OPEN', 'EARLY_DOMAIN_PROGRESSION',
    'INPUT_DISPOSE_STOPPED_BORROWED_ROOT', 'INPUT_DISPOSE_CLOSED_BORROWED_CONTEXT', 'ANALYSIS_CLONE_NOT_ENDED'];
  const invariant = codes.find(c => message.includes(c));
  if (running && trace.status === 'FAILED' && invariant) return {
    disposition: contract.productionDisposition, reason: 'IMMUTABLE_EXECUTABLE_CONCRETE_PRODUCTION_INVARIANT',
    invariant, causalWitness: { initial: trace.initial, failureState: trace.failureState, modelReceipt: trace.modelReceipt, teardown: trace.teardown }
  };
  return { disposition: INTEGRITY, reason: 'TOOL_PROTOCOL_AUDIT_ENVIRONMENT_OR_UNRESOLVED_CAUSALITY',
    runningRealGraph: !!running, resourceCreationAloneIsNotDefect: true, message };
}
