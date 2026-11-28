import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
assert.equal(process.getuid(),10001);
assert.equal(process.getgid(),10001);
assert.throws(()=>fs.writeFileSync('/app/forbidden-write','x'),{code:'EROFS'});
fs.writeFileSync('/tmp/smoke-write','ok');
if (process.env.SMOKE_CACHE_PATH) fs.writeFileSync(process.env.SMOKE_CACHE_PATH,'ok');
const child=spawn('npm',['run','start'],{cwd:'/app',stdio:['ignore','pipe','pipe']});
let requested=false;
let output="";
const timeout=setTimeout(()=>{console.error('Startup deadline exceeded');child.kill();process.exit(1)},25000);
child.stderr.on('data',data=>process.stderr.write(data));
child.stdout.on('data',data=>{
  process.stdout.write(data);
  output=(output+data.toString()).slice(-1024);
  if (!requested && /ready in/i.test(output)) {
    requested=true;
    http.get({host:'127.0.0.1',port:3000,path:process.env.SMOKE_PATH},response=>{
      assert.equal(response.statusCode,200);
      assert.ok(response.headers['content-security-policy']);
      response.resume();
      response.on('end',()=>{clearTimeout(timeout); console.log('READ_ONLY_NON_ROOT_HTTP_SMOKE PASS');child.kill('SIGTERM');process.exit(0)});
    }).on('error',error=>{throw error});
  }
});
child.on('exit',code=>{if(!requested){clearTimeout(timeout);process.exit(code||1)}});
