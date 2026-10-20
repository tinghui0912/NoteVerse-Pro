$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'));$app=Join-Path $root 'apps/customer-web'
$base=@('run','--rm','--network','none','--mount',"type=bind,source=$root,target=/workspace,readonly",'--mount',"type=bind,source=$root/backend,target=/backend,readonly",
 '--mount',"type=bind,source=$app,target=/app,readonly",'--mount','type=volume,source=noteverse-xc5-check-deps,target=/app/node_modules',
 '--mount',"type=bind,source=$app/node_modules/onnxruntime-web,target=/app/node_modules/onnxruntime-web,readonly",
 '--mount',"type=bind,source=$app/node_modules/onnxruntime-common,target=/app/node_modules/onnxruntime-common,readonly",
 '--mount',"type=bind,source=$app/node_modules/@hey-api,target=/app/node_modules/@hey-api,readonly",'-e','XC5_REPO_ROOT=/workspace','-w','/app','--entrypoint','node','noteverse-customer-web-dev:dev')
$commands=@(($base+@('node_modules/vitest/vitest.mjs','run','src/lib/practice/acoustic-inference/xc6-capture-bridge.test.ts','src/lib/practice/acoustic-inference/xc4-robust-runtime.test.ts','src/lib/practice/input-capability.test.ts')),($base+@('node_modules/typescript/bin/tsc','--noEmit','--incremental','false')))
$runs=@()
foreach($arguments in $commands){$ErrorActionPreference='Continue';try{$output=& docker @arguments 2>&1|ForEach-Object{"$_"};$code=$LASTEXITCODE}finally{$ErrorActionPreference='Stop'}
 $runs+=@{command=@('docker')+$arguments;exitCode=$code;output=$output};$output|Write-Output;if($code-ne0){throw 'XC6_CHECK_FAILED'}}
$dest=Join-Path $root 'backend/data/work/xc6_capture/checks.json'
if(Test-Path -LiteralPath $dest){throw 'XC6_CHECK_RECEIPT_EXISTS'}
[IO.File]::WriteAllText($dest,(@{runs=$runs}|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
