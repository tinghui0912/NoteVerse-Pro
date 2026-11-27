import * as sdk from "../generated/api/sdk.gen";
import type {
  OperatorLoginData,
  OperatorMfaEnrollmentConfirmData,
  OperatorMfaVerifyData,
  OpsAsyncOperationsListData,
  OpsAsyncOperationsSummaryGetData,
  OpsAsyncOperationRetryData,
  AuditLogsListData,
  OperatorsListData,
  OperatorCreateData,
  OperatorUpdateData,
  OperatorMfaResetData,
  OperatorPasswordResetData,
  CustomersListData,
  CustomerStatusUpdateData,
} from "../generated/api/types.gen";
import { controlPlaneBrowserClient } from "./control-plane-browser-transport";

const options = {
  client: controlPlaneBrowserClient,
  throwOnError: true,
} as const;
export async function login(body: OperatorLoginData["body"]) {
  return (await sdk.operatorLogin({ ...options, body })).data;
}
export async function startMfaEnrollment() {
  return (await sdk.operatorMfaEnrollmentStart(options)).data;
}
export async function confirmMfaEnrollment(
  body: OperatorMfaEnrollmentConfirmData["body"],
) {
  return (await sdk.operatorMfaEnrollmentConfirm({ ...options, body })).data;
}
export async function verifyMfa(body: OperatorMfaVerifyData["body"]) {
  return (await sdk.operatorMfaVerify({ ...options, body })).data;
}
export async function logout(): Promise<void> {
  await sdk.operatorLogout(options);
}
export async function currentOperator(signal?: AbortSignal) {
  return (await sdk.operatorCurrentGet({ ...options, signal })).data;
}
export async function listAsyncOperations(
  query: OpsAsyncOperationsListData["query"] = {},
) {
  return (await sdk.opsAsyncOperationsList({ ...options, query })).data;
}
export async function asyncOperationsSummary(
  query: OpsAsyncOperationsSummaryGetData["query"] = {},
) {
  return (await sdk.opsAsyncOperationsSummaryGet({ ...options, query })).data;
}
export async function retryAsyncOperation(
  path: OpsAsyncOperationRetryData["path"],
  body: OpsAsyncOperationRetryData["body"],
) {
  return (await sdk.opsAsyncOperationRetry({ ...options, path, body })).data;
}
export async function listAuditLogs(query: AuditLogsListData["query"] = {}) {
  return (await sdk.auditLogsList({ ...options, query })).data;
}
export async function listOperators(query: OperatorsListData["query"] = {}) {
  return (await sdk.operatorsList({ ...options, query })).data;
}
export async function createOperator(body: OperatorCreateData["body"]) {
  return (await sdk.operatorCreate({ ...options, body })).data;
}
export async function updateOperator(
  path: OperatorUpdateData["path"],
  body: OperatorUpdateData["body"],
) {
  return (await sdk.operatorUpdate({ ...options, path, body })).data;
}
export async function resetOperatorMfa(
  path: OperatorMfaResetData["path"],
  body: OperatorMfaResetData["body"],
) {
  await sdk.operatorMfaReset({ ...options, path, body });
}
export async function resetOperatorPassword(
  path: OperatorPasswordResetData["path"],
  body: OperatorPasswordResetData["body"],
) {
  await sdk.operatorPasswordReset({ ...options, path, body });
}
export async function listUsers(query: CustomersListData["query"] = {}) {
  return (await sdk.customersList({ ...options, query })).data;
}
export async function updateUserStatus(
  path: CustomerStatusUpdateData["path"],
  body: CustomerStatusUpdateData["body"],
) {
  await sdk.customerStatusUpdate({ ...options, path, body });
}
