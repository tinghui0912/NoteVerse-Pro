import { execFileSync } from 'node:child_process';

const generatedContracts = [
  { path: 'generated/api' },
];

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' });
}

function assertGeneratedOutputIsCommitted(path) {
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', path]).trim();
  if (untracked) {
    throw new Error(
      `Generated Control Plane API artifacts include untracked files:\n${untracked}\nCommit the generated output before running this check.`
    );
  }

  try {
    run('git', ['diff', '--exit-code', 'HEAD', '--', path]);
  } catch {
    throw new Error(
      `Generated Control Plane API artifacts differ from HEAD for ${path}. Run the matching generate:api command and commit the result.`
    );
  }
}

for (const contract of generatedContracts) {
  const args = ['node_modules/@hey-api/openapi-ts/bin/run.js'];
  if (contract.config) args.push('-f', contract.config);
  run(process.execPath, args);

  assertGeneratedOutputIsCommitted(contract.path);
}

process.stdout.write('Generated Control Plane API artifacts are current.\n');
