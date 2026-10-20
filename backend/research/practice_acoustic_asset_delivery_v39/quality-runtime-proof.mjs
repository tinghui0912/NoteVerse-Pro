import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { START, gitBytes, verifyPath, REQUIRED } from './discovery.mjs';

export function qualityRuntimeProof() {
  const yaml = createRequire(path.resolve('apps/customer-web/package.json'))('js-yaml');
  const records = [], seen = new Set();
  const source = file => {
    if (!seen.has(file)) { records.push(verifyPath(args => gitBytes(...args), START, file)); seen.add(file); }
    return gitBytes('show', START + ':' + file).toString('utf8');
  };
  const apiDocker = source('docker/backend/Dockerfile.api');
  const qualityDocker = source('docker/backend/Dockerfile.quality');
  const core = source('backend/requirements/quality-core.txt'), tools = source('backend/requirements/quality-tools.txt');
  const closure = [];
  const dependencies = file => {
    if (closure.includes(file)) return;
    closure.push(file);
    for (const line of source(file).split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))) {
      if (line.startsWith('-r ')) dependencies(path.posix.join(path.posix.dirname(file), line.slice(3).trim()));
      else assert.equal(/^pytest(?:==|>=|<=|~=|!=|>|<|\s|$)/i.test(line), false, 'PYTEST_MUST_NOT_BE_API_DEPENDENCY');
    }
  };
  dependencies('backend/requirements/api.txt');
  const compose = yaml.load(source('docker-compose.backend-dev.yml'));
  const wrapper = source('scripts/backend_quality_docker.ps1'), workflow = yaml.load(source('.github/workflows/backend-quality.yml'));
  const steps = workflow.jobs.quality.steps;
  const facts = {
    apiDockerDoesNotInstallQualityTools: !apiDocker.includes('quality-tools.txt') && !apiDocker.includes('quality-core.txt'),
    apiDependencyClosureDoesNotEstablishPytest: !closure.includes('backend/requirements/quality-tools.txt'),
    qualityCoreIncludesQualityTools: /^-r quality-tools\.txt$/m.test(core.replaceAll('\r', '')),
    qualityToolsPinsPytest: /^pytest==[0-9.]+$/m.test(tools.replaceAll('\r', '')),
    qualityDockerInstallsQualityCore: qualityDocker.includes('pip install -r /tmp/requirements/quality-core.txt'),
    composeDedicatedQualityService: compose.services.quality.build.dockerfile === 'docker/backend/Dockerfile.quality',
    wrapperUsesQualityServiceForPytest: wrapper.includes('run --rm --build quality') && wrapper.includes('python -m pytest'),
    backendCiBuildsAndUsesQualityImageForPytest: steps.some(s => s.run?.includes('docker build -f ../docker/backend/Dockerfile.quality'))
      && steps.some(s => s.run?.includes('"$QUALITY_IMAGE"') && s.run?.includes('python -m pytest')),
    documentationSeparatesRuntimeAndQuality: source('backend/README.md').includes('Runtime images do not install development or quality tools')
  };
  for (const [name, value] of Object.entries(facts)) assert.equal(value, true, name);
  assert.ok(REQUIRED.includes('docker/backend/Dockerfile.quality'));
  return { result: 'READ_ONLY_STATIC_PASS', records, facts,
    invariant: 'BACKEND_TESTS_MUST_NOT_EXECUTE_IN_API_RUNTIME_CONTAINER',
    v38HistoricalDispositionUnchanged: true, doesNotQualifyDelivery: true };
}
