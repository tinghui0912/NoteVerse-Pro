import { createRequire } from 'node:module';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { load, save, OUT, now } from './io.mjs';

// Additive diagnosis only. No bundler import, build, tests, or qualification retry.
const failure = load(OUT + '/first-failure.json');
const require = createRequire(path.resolve('apps/customer-web/package.json'));
let resolver;
try { resolver = { available: true, resolvedPath: require.resolve('esbuild') }; }
catch (error) { resolver = { available: false, errorClass: error.name, errorCode: error.code ?? null }; }
const record = { at: now(), purpose: 'Read-only dependency resolution after permanent V40 stop',
  activeLocalGate: failure.activeLocalGate, orchestratorBoundary: failure.orchestratorBoundary,
  firstFailureUnchanged: true, bundlerExecuted: false, buildRetried: false, packagesInstalled: false,
  esbuildResolver: resolver, bundlesDirectoryExists: existsSync(OUT + '/bundles'),
  qualificationBundleExists: existsSync(OUT + '/bundles/entry.js'),
  causalLimit: 'Original in-process exception text was not retained by preflight. This later resolution observation is supplemental, not reconstructed original error output.' };
save('post-stop-availability.json', record);
console.log(JSON.stringify(record));
