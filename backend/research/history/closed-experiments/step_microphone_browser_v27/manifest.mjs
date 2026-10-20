import assert from 'node:assert/strict';
import path from 'node:path';
import { ROOT,V26,V26SRC,bytes,load,sha,canonical } from './io.mjs';

export const accepted={
  [V26+'/bundles/entry.js']:'94a042eb56bb6bea42521e65547cab632ab84b693379599a1d55dff4824fac35',
  [V26+'/bundles/worker.js']:'fa72177cc90c3d91a7b48ef57225624cedd69e8dc232eb6bd8cc83ad502b0526',
  [V26+'/browser-input.wav']:'47e9287126bd2b0f1589abb972c98bac467c1850b2ad620a7b3604d26d9b316b',
  [V26+'/build-and-environment.json']:'0d46a0b1a5b3ba4be3343ab99b6e07061d5600973c497eb093a755aba18e58d9',
  [V26SRC+'/contract.json']:'f983c5f9f234b6ec13d2e1bd30696a20b4d922c89a70dd3104bbdc5976221056'
};
export const virtualAllowlist=Object.freeze(['<define:process.env>']);
export function consistent(map,key,identity){
  const old=map.get(key);if(old)assert.deepStrictEqual(old,identity,'DUPLICATE_INPUT_IDENTITY_DISAGREEMENT:'+key);else map.set(key,identity);
}
export async function classifyInputs(bundles,provenanceDigest,read=bytes){
  const files=new Map(),physical=new Map(),virtual=new Map(),occurrences=[];
  for(const bundle of bundles)for(const [ordinal,name]of bundle.inputs.entries()){
    if(virtualAllowlist.includes(name)){
      const base={kind:'ESBUILD_VIRTUAL_INPUT',identifier:name,buildSemanticRecordSha256:provenanceDigest,
        provenance:'esbuild process.env define expression {}; not a filesystem file and has no filesystem SHA'};
      consistent(virtual,name,base);occurrences.push({bundle:bundle.path,ordinal,metafileInputName:name,kind:base.kind,identifier:name});continue;
    }
    if(name.startsWith('<')||name.endsWith('>'))throw Error('STEP_V27_UNEXPECTED_ESBUILD_VIRTUAL_INPUT:'+name);
    const full=path.resolve(ROOT,name),relative=path.relative(ROOT,full).replaceAll('\\','/');
    assert.ok(relative&&!relative.startsWith('../')&&!path.isAbsolute(relative),'FILESYSTEM_INPUT_OUTSIDE_REPOSITORY');
    const b=await read(relative),identity={path:relative,sha256:sha(b),bytes:b.length};
    consistent(physical,relative,identity);
    const record={kind:'FILESYSTEM_INPUT',metafileInputName:name,...identity};consistent(files,name,record);
    occurrences.push({bundle:bundle.path,ordinal,metafileInputName:name,kind:record.kind,path:relative,sha256:record.sha256});
  }
  return {filesystemInputs:[...files.values()],virtualInputs:[...virtual.values()].map(v=>({...v,
    bundles:bundles.filter(b=>b.inputs.includes(v.identifier)).map(b=>b.path)})),occurrences};
}
export async function verifyImmutable(){
  const artifacts=[];for(const [p,expected]of Object.entries(accepted)){
    const b=await bytes(p);assert.equal(sha(b),expected,'STEP_V27_IMMUTABLE_V26_EXECUTABLE_INPUT_MISMATCH:'+p);artifacts.push({path:p,sha256:expected,bytes:b.length});
  }
  const build=await load(V26+'/build-and-environment.json'),assets=[];
  for(const [route,a]of Object.entries(build.assets)){const b=await bytes(a.path);assert.equal(sha(b),a.sha256,'V26_ASSET_SHA:'+route);assert.equal(b.length,a.bytes,'V26_ASSET_BYTES:'+route);assets.push({route,...a});}
  return {artifacts,assets,build};
}
export async function buildSemantics(build){
  const packages=['backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/package.json',
    'backend/data/work/basic_pitch_browser_feasibility/node_modules/esbuild/lib/main.js'];
  const packageIdentities=[];for(const p of packages){const b=await bytes(p);packageIdentities.push({path:p,sha256:sha(b),bytes:b.length});}
  const tsconfig='apps/customer-web/tsconfig.json',source=V26SRC+'/run.mjs';
  const record={platform:'browser',format:'esm',target:'es2022',bundle:true,metafile:true,logLevel:'silent',
    define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},
    tsconfig:{path:tsconfig,sha256:sha(await bytes(tsconfig))},
    esbuild:{packagePath:packages[0],version:(await load(packages[0])).version,packageIdentities},
    externalResolver:{specifier:'onnxruntime-web/webgpu',result:'/ort/ort.webgpu.min.mjs',external:true,plugin:'accepted-pinned-ort-external'},
    nodePaths:['apps/customer-web/node_modules'],absWorkingDir:'REPOSITORY_ROOT',
    configurationSource:{path:source,sha256:sha(await bytes(source)),configuration:'Original V26 prepare/rebuild-prefreeze options; source read as bytes only, never imported'},
    entrypoints:await Promise.all(build.bundles.map(async b=>({entry:b.entry,entrySha256:sha(await bytes(b.entry)),output:b.path,outputSha256:b.sha256}))),
    resultAuthority:'IMMUTABLE_PREPARED_BUNDLE_BYTES_NO_REBUILD_IN_V27'};
  return {record,canonicalSha256:sha(Buffer.from(canonical(record))),digestMeaning:'SHA256 of canonical build-semantic record, NOT virtual-node bytes'};
}
export async function completeManifest(){
  const immutable=await verifyImmutable(),semantics=await buildSemantics(immutable.build);
  const inputs=await classifyInputs(immutable.build.bundles,semantics.canonicalSha256);
  assert.deepStrictEqual(inputs.virtualInputs.map(v=>v.identifier).sort(),[...virtualAllowlist],'EXPECTED_VIRTUAL_INPUT_SET_EXACT');
  for(const v of inputs.virtualInputs)assert.ok(!('sha256'in v)&&!('path'in v),'VIRTUAL_NODE_MUST_NOT_HAVE_FILE_IDENTITY');
  return {...immutable,semantics,...inputs};
}
