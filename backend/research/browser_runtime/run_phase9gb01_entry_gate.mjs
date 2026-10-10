/**
 * Phase 9G-B.0.1 Unified Entry-Gate Runner.
 *
 * Orchestrates:
 * 1. Component A: Evidence Preparation (run_phase9gb01_evidence_prep.mjs)
 * 2. Component B: Independent Entry-Gate Verification (verify_phase9gb01_entry_gate.mjs)
 *
 * Enforces non-negotiable restrictions:
 * - NO neural inference executed on blind performers p15-p22 or calibration performers p07-p14
 * - NO production winner selected
 * - NO production microphone activation
 * - Clean working tree requirement (unless --allow-dirty)
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { preparePhase9gb01Evidence } from './run_phase9gb01_evidence_prep.mjs';
import { verifyPhase9gb01EntryGate } from './verify_phase9gb01_entry_gate.mjs';

const repoRoot = process.cwd();

function getGitHead(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  } catch {
    return 'UNKNOWN';
  }
}

function getGitDirty(dir) {
  try {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' });
    return status.trim().length > 0;
  } catch {
    return true;
  }
}

async function main() {
  const allowDirty = process.argv.includes('--allow-dirty');
  const dirty = getGitDirty(repoRoot);
  if (dirty && !allowDirty) {
    throw new Error('PHASE_9GB01_REQUIRES_CLEAN_WORKING_TREE: Commit changes before generating evidence artifacts.');
  }

  const gitHead = getGitHead(repoRoot);
  console.log(`\n===============================================================`);
  console.log(`  Phase 9G-B.0.1 Evidence-Backed Blind Entry Gate`);
  console.log(`  Git HEAD: ${gitHead} (dirty: ${dirty})`);
  console.log(`===============================================================\n`);

  // Step 1: Component A (Evidence Preparation)
  console.log('>>> Executing Component A (Evidence Preparation)...');
  await preparePhase9gb01Evidence({ gitHead, dirty: dirty && !allowDirty });

  // Step 2: Component B (Independent Entry-Gate Verification)
  console.log('\n>>> Executing Component B (Independent Entry-Gate Verification)...');
  const report = await verifyPhase9gb01EntryGate({ gitHead, dirty: dirty && !allowDirty });

  if (report.overallStatus !== 'PASS') {
    console.error('\n[FATAL] Phase 9G-B.0.1 Entry Gate Verification FAILED.');
    process.exit(1);
  }

  console.log('\n[SUCCESS] Phase 9G-B.0.1 Entry Gate Verification PASSED all 11 checks.');
  console.log(`Preflight Gate Outcome: ${report.preflightGateOutcome}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
