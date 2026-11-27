/** Device-condition copy shared only by the Practice status row and its popovers. */
export const practiceDeviceIssueMessageKeys = Object.freeze({
  INTERRUPTED: 'deviceInterrupted',
  LOST: 'deviceDisconnected',
  PERMISSION_DENIED: 'devicePermissionDenied',
  NOT_FOUND: 'deviceNotFound',
  BUSY: 'deviceBusy',
  UNAVAILABLE: 'deviceUnavailable',
} as const);
