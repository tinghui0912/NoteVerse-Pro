$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$app = Join-Path $root 'apps/customer-web'
$argsBase = @('run','--rm','--network','none',
    '--mount',"type=bind,source=$root,target=/workspace,readonly",
    '--mount',"type=bind,source=$root/backend,target=/backend,readonly",
    '--mount',"type=bind,source=$app,target=/app,readonly",
    '--mount','type=volume,source=noteverse-xc5-check-deps,target=/app/node_modules',
    '--mount',"type=bind,source=$app/node_modules/onnxruntime-web,target=/app/node_modules/onnxruntime-web,readonly",
    '--mount',"type=bind,source=$app/node_modules/onnxruntime-common,target=/app/node_modules/onnxruntime-common,readonly",
    '--mount',"type=bind,source=$app/node_modules/@hey-api,target=/app/node_modules/@hey-api,readonly",
    '-e','XC5_REPO_ROOT=/workspace','-w','/app','--entrypoint','node','noteverse-customer-web-dev:dev')
$commands = @(
    ($argsBase + @('node_modules/vitest/vitest.mjs','run','src/lib/practice/acoustic-inference/xc4-robust-runtime.test.ts',
      'src/lib/practice/acoustic-inference/bytedance-inference.test.ts',
      'src/lib/practice/audio-analysis/capture/performance-pcm-timeline.test.ts','src/lib/practice/input-capability.test.ts')),
    ($argsBase + @('node_modules/typescript/bin/tsc','--noEmit','--incremental','false'))
)
$runs=@()
foreach ($arguments in $commands) {
    $ErrorActionPreference='Continue'
    try { $output=& docker @arguments 2>&1 | ForEach-Object { "$_" }; $code=$LASTEXITCODE }
    finally { $ErrorActionPreference='Stop' }
    $runs+=@{command=@('docker')+$arguments;exitCode=$code;output=$output}
    $output | Write-Output
    if ($code -ne 0) { throw 'XC5_FOCUSED_CHECK_FAILED' }
}
$work=Join-Path $root 'backend/data/work/xc5_runtime'
[IO.Directory]::CreateDirectory($work) | Out-Null
$dest=Join-Path $work 'checks.json'
if(Test-Path -LiteralPath $dest){throw 'XC5_CHECK_RECEIPT_EXISTS'}
[IO.File]::WriteAllText($dest,(@{runs=$runs;phase='PHASE_9G_XC5_XC4_ALIGNED_DISABLED_BROWSER_ACOUSTIC_RUNTIME'} | ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
