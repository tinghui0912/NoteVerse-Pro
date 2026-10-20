$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$phase = 'PHASE_9G_XC4_EVIDENCE_CONVERGENCE_AND_ENGINEERING_DEFAULT_FREEZE'
$mount = "type=bind,source=$root,target=/workspace,readonly"
$runs = @()
$commands = @(
    @('run', '--rm', '--network', 'none', '--mount', $mount, '-w', '/workspace',
      'noteverse-xc1-r3d-science:local', 'python', '-m', 'unittest', 'discover', '-s',
      'backend/research', '-p', 'test_xc4_engineering_default.py', '-v'),
    @('run', '--rm', '--network', 'none', '--mount', $mount, '-w', '/workspace',
      'node:24-bookworm', 'node', '--test',
      'backend/research/browser_runtime/test_xc2_r1_bounded.mjs',
      'backend/research/browser_runtime/test_xc2_r2_direct_conflict.mjs'),
    @('run', '--rm', '--network', 'none', '--mount', $mount, '-w', '/workspace',
      'node:24-bookworm', 'node', '--test', '--test-name-pattern=CURRENT direct parity|all frozen geometries|decoder variants',
      'backend/research/browser_runtime/test_xc2_product.mjs')
)
foreach ($arguments in $commands) {
    $start = [DateTime]::UtcNow.ToString('o')
    $ErrorActionPreference = 'Continue'
    try {
        $output = & docker @arguments 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    $runs += @{ command = @('docker') + $arguments; exitCode = $code; startedAt = $start; output = $output }
    if ($code -ne 0) { $output | Write-Output; throw 'XC4_REGRESSION_FAILED' }
}
$source = 'backend/research/run_xc4_regressions.ps1'
$receipt = @{ phase = $phase; runs = $runs; newNeuralInferenceCount = 0
    selectionNote = 'Focused existing local suites: R1/R2 synthetic regressions plus product decoder A direct parity, geometry and decoder determinism. Preliminary aggregate invocation encountered nested-Docker ENOENT and read-only work-tree temp-path EROFS in unrelated tests. Those paths are not claimed PASS. No historical test edits, model/browser or benchmark run.'
    sourceHashBoundary = @(@{ path = $source; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root $source)).Hash.ToLowerInvariant() }) }
$work = Join-Path $root 'backend/data/work/xc4_convergence'
[IO.Directory]::CreateDirectory($work) | Out-Null
$path = Join-Path $work 'regression_receipt.json'
if (Test-Path -LiteralPath $path) { throw 'XC4_RECEIPT_ALREADY_EXISTS' }
[IO.File]::WriteAllText($path, ($receipt | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
Write-Output "XC4 regressions PASS: $path"
