import { operatorLogin, operatorLogout, operatorCurrentGet, opsAsyncOperationsList, opsAsyncOperationsSummaryGet, opsAsyncOperationRetry, opsAuditEventsList } from "../generated/api/sdk.gen";
import type { OperatorLoginData, OpsAsyncOperationsListData, OpsAsyncOperationsSummaryGetData, OpsAsyncOperationRetryData, OpsAuditEventsListData } from "../generated/api/types.gen";
import { controlPlaneBrowserClient } from "./control-plane-browser-transport";

const options = { client: controlPlaneBrowserClient, throwOnError: true } as const;

export async function login(body: OperatorLoginData["body"]): Promise<void> {
  await operatorLogin({ ...options, body });
}
export async function logout(): Promise<void> {
  await operatorLogout(options);
}
export async function currentOperator() {
  return (await operatorCurrentGet(options)).data;
}
export async function listAsyncOperations(query: OpsAsyncOperationsListData["query"] = {}) {
  return (await opsAsyncOperationsList({ ...options, query })).data;
}
export async function asyncOperationsSummary(query: OpsAsyncOperationsSummaryGetData["query"] = {}) {
  return (await opsAsyncOperationsSummaryGet({ ...options, query })).data;
}
export async function retryAsyncOperation(path: OpsAsyncOperationRetryData["path"], body: OpsAsyncOperationRetryData["body"]) {
  return (await opsAsyncOperationRetry({ ...options, path, body })).data;
}
export async function listOpsAuditEvents(query: OpsAuditEventsListData["query"] = {}) {
  return (await opsAuditEventsList({ ...options, query })).data;
}
