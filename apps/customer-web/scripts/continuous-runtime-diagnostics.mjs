/** ORT uses stderr/console.error even for these pinned [W:] dependency diagnostics. */
export function classifyRuntimeDiagnostic(row, model) {
  const exactPinnedOrigin = /\/ort\/ort-wasm-simd-threaded\.jsep\.mjs$/.test(row.location?.url ?? '');
  const verifiedProvider = model?.executionProvider === 'webgpu' && model?.automaticFallback === false && model?.ortWebVersion === '1.20.1';
  const knownWarning = /\[W:onnxruntime:, session_state\.cc:1168 VerifyEachNodeIsAssignedToAnEp\] Some nodes were not assigned to the preferred execution providers/.test(row.text ?? '')
    || /\[W:onnxruntime:, session_state\.cc:1170 VerifyEachNodeIsAssignedToAnEp\] Rerunning with verbose output on a non-minimal build will show node assignments\./.test(row.text ?? '');
  if (row.type === 'error' && exactPinnedOrigin && verifiedProvider && knownWarning) return 'DEPENDENCY_DIAGNOSTIC_NON_BLOCKING';
  return ['error', 'pageerror', 'failed-response', 'requestfailed'].includes(row.type) ? 'BLOCKING_DIAGNOSTIC' : 'INFORMATIONAL';
}
