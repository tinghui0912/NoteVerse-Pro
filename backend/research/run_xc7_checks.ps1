$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'));$app=Join-Path $root 'apps/customer-web'
& node (Join-Path $app 'scripts/xc7-evidence.mjs') verify
if($LASTEXITCODE-ne0){throw 'XC7_REMOTE_FREEZE_REQUIRED'}
$base=@('run','--rm','--network','none','--mount',"type=bind,source=$root,target=/workspace,readonly",'--mount',"type=bind,source=$root/backend,target=/backend,readonly",
 '--mount',"type=bind,source=$app,target=/app,readonly",'--mount','type=volume,source=noteverse-xc5-check-deps,target=/app/node_modules',
 '--mount',"type=bind,source=$app/node_modules/onnxruntime-web,target=/app/node_modules/onnxruntime-web,readonly",
 '--mount',"type=bind,source=$app/node_modules/onnxruntime-common,target=/app/node_modules/onnxruntime-common,readonly",
 '--mount',"type=bind,source=$app/node_modules/@hey-api,target=/app/node_modules/@hey-api,readonly",
 '--mount',"type=bind,source=$root/backend/data/work/xc7_bounded,target=/evidence",'-e','XC7_TEST_EVIDENCE=/evidence',
 '-e',"XC7_FREEZE_ID=$(if($env:XC7_FREEZE_ID){$env:XC7_FREEZE_ID}else{'v1'})",'-e','XC5_REPO_ROOT=/workspace','-w','/app','--entrypoint','node','noteverse-customer-web-dev:dev')
$id=if($env:XC7_FREEZE_ID){$env:XC7_FREEZE_ID}else{'v1'}
$commands=@(($base+@('node_modules/vitest/vitest.mjs','run','src/lib/practice/acoustic-inference/xc7-bounded-resources.test.ts',
 'src/lib/practice/acoustic-inference/xc6-capture-bridge.test.ts','src/lib/practice/acoustic-inference/xc4-robust-runtime.test.ts',
 'src/lib/practice/input-capability.test.ts','--reporter=json',"--outputFile=/evidence/vitest_$id.json")),
 ($base+@('node_modules/typescript/bin/tsc','--noEmit','--incremental','false')))
$runs=@()
foreach($arguments in $commands){$started=[DateTime]::UtcNow.ToString('o');$ErrorActionPreference='Continue'
 try{$output=& docker @arguments 2>&1|ForEach-Object{"$_"};$code=$LASTEXITCODE}finally{$ErrorActionPreference='Stop'}
 $runs+=@{command=@('docker')+$arguments;exitCode=$code;startedAt=$started;endedAt=[DateTime]::UtcNow.ToString('o');output=$output}
 $output|Write-Output
 if($code-ne0){$failure=Join-Path $root "backend/data/work/xc7_bounded/checks_failure_$id.json"
  [IO.File]::WriteAllText($failure,(@{runs=$runs}|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false));throw 'XC7_CHECK_FAILED_SOURCE_REPAIR_REQUIRES_NEW_FREEZE'}
}
$dest=Join-Path $root "backend/data/work/xc7_bounded/checks_$id.json"
if(Test-Path -LiteralPath $dest){throw 'XC7_CHECK_RECEIPT_EXISTS'}
[IO.File]::WriteAllText($dest,(@{runs=$runs}|ConvertTo-Json -Depth 20),[Text.UTF8Encoding]::new($false))
