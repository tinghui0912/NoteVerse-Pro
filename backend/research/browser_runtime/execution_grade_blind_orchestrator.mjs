/**
 * Phase 9G-B.2-PRE: Execution-Grade Blind Evaluation Orchestrator & Durable One-Shot Journal.
 *
 * Implements the modular, testable, score-blind evaluation pipeline:
 * - Layer 1: Pre-inference layer (manifest validation, audio geometry eligibility, code/checkpoint bindings)
 * - Layer 2: Exclusive atomic run reservation ('wx' lock), append-only cryptographic event journal, atomic file publication
 * - Layer 3: Acoustic execution layer (mandatory preflight, score-blind adapter receiving strictly sanitized audio metadata)
 * - Layer 4: Evidence commit layer (durable immutable raw output blob & observation digest commit before truth access)
 * - Layer 5: Scoring layer (shared scoreCandidate() reading publications strictly from committed disk evidence)
 * - Layer 6: Statistical & Decision layer (5000-draw seeded bootstrap & symmetric safety-first decision hierarchy)
 * - Layer 7: Audit layer (independent disk readback, digest verification, and one-shot run status)
 *
 * Enforces non-negotiable boundaries:
 * - Real candidate inference on blind performers p15-p22 is STRICTLY FORBIDDEN in Phase 9G-B.2-PRE.
 * - Score-conditioned inference is detected and rejected.
 * - Zero production winner selected; production microphone inactive.
 */

import { createHash } from 'node:crypto';
import { existsSync, openSync, closeSync, readFileSync, appendFileSync, renameSync, unlinkSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const challengerQual = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));
const bakeoffScorer = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'));

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256Json(obj) {
  return sha256Text(JSON.stringify(obj));
}

export const FROZEN_V4_PROTOCOL_ID = '9G-B-BLIND-V4';
export const FROZEN_V5_PROTOCOL_ID = '9G-B-BLIND-V5';
export const TRUSTED_BLIND_PROTOCOL_V4_SHA256 = 'f0d411bc0876a5f97d05a865c180bbba685a18fb3d040da3a0a05ac11d940f67';

export function getTrustedProtocolSha256(protocolId) {
  if (protocolId === '9G-B-BLIND-V5' || protocolId === 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V5') {
    const v5Path = path.resolve(repoRoot, 'backend/research/policies/phase9g_b_blind_evaluation_protocol_v5_2026-10-10.json');
    if (existsSync(v5Path)) {
      return sha256Buffer(readFileSync(v5Path));
    }
  }
  if (protocolId === '9G-B-BLIND-V4' || protocolId === 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V4') {
    return TRUSTED_BLIND_PROTOCOL_V4_SHA256;
  }
  return null;
}

// Frozen 3-candidate competitive roster constants
export const FROZEN_RANKED_ROSTER = {
  'bytedance-original-calibrated-v1': {
    candidateId: 'bytedance-original-calibrated-v1',
    candidateFamily: 'bytedance-original',
    profileId: 'bytedance-original-calibration-CALIBRATED_CONTEXT_5S-onset-0.20-frame-0.10',
    configurationSha256: '91a6fc6d33575edf9b8eb3adc78a21a4ea28d7581e3c7eb56a882e0fe6dd9285',
    checkpointSha256: 'c3fa9730725bf4a762f1c14bc80cd5986eacda01b026f5a4a2525cd607876141',
    checkpointBytes: 171966578,
    checkpointByteSize: 171966578,
    requiredContextMs: 5000,
    eligibleScenarioCount: 63,
  },
  'online-amt-calibrated-v1': {
    candidateId: 'online-amt-calibrated-v1',
    candidateFamily: 'online-amt',
    profileId: 'online-amt-calibration-native-boost-1',
    configurationSha256: '0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375',
    checkpointSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
    checkpointBytes: 178804960,
    checkpointByteSize: 178804960,
    requiredContextMs: 0,
    eligibleScenarioCount: 70,
  },
  'bytedance-robust-augmented-calibrated-v1': {
    candidateId: 'bytedance-robust-augmented-calibrated-v1',
    candidateFamily: 'bytedance-robust-augmented',
    profileId: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
    configurationSha256: '10ca01435f68b0672d01e2328762ea0773efb15b318dcd1c21105e05f9ee51ce',
    checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
    checkpointBytes: 103815845,
    checkpointByteSize: 103815845,
    requiredContextMs: 1820,
    eligibleScenarioCount: 63,
  },
};

// ---------------------------------------------------------------------------
// Atomic File Publication Helper (same-filesystem rename)
// ---------------------------------------------------------------------------

export async function atomicWriteJson(targetPath, data) {
  const dir = path.dirname(targetPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  // On Windows, rename over an existing target can throw transient EPERM/EBUSY
  let renamed = false;
  let lastErr;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      renameSync(tmpPath, targetPath);
      renamed = true;
      break;
    } catch (err) {
      lastErr = err;
      if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
        await new Promise((res) => setTimeout(res, 10 * (attempt + 1)));
      } else {
        try { unlinkSync(tmpPath); } catch {}
        throw err;
      }
    }
  }

  if (!renamed) {
    try {
      if (existsSync(targetPath)) {
        unlinkSync(targetPath);
      }
      renameSync(tmpPath, targetPath);
    } catch (fallbackErr) {
      try { unlinkSync(tmpPath); } catch {}
      throw lastErr || fallbackErr;
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 1: Objective Audio Geometry Eligibility
// ---------------------------------------------------------------------------

export function deriveScenarioEligibility(scenario, candidateProfileId) {
  const originMs = scenario.audio?.performanceOriginSourceMs ?? scenario.performanceOriginSourceMs ?? 0;

  if (candidateProfileId.includes('CALIBRATED_CONTEXT_5S')) {
    const requiredContextMs = 5000;
    const isEligible = originMs >= requiredContextMs;
    return {
      candidateProfileId,
      scenarioId: scenario.scenarioId,
      isEligible,
      originMs,
      requiredContextMs,
      exclusionReason: isEligible ? undefined : 'INSUFFICIENT_PRE_ROLL_AUDIO_FOR_5S_CONTEXT',
    };
  }

  if (candidateProfileId.includes('CALIBRATED_CONTEXT_1820')) {
    const requiredContextMs = 1820;
    const isEligible = originMs >= requiredContextMs;
    return {
      candidateProfileId,
      scenarioId: scenario.scenarioId,
      isEligible,
      originMs,
      requiredContextMs,
      exclusionReason: isEligible ? undefined : 'INSUFFICIENT_PRE_ROLL_AUDIO_FOR_1820MS_CONTEXT',
    };
  }

  // Streaming causal (Online-AMT native boost)
  return {
    candidateProfileId,
    scenarioId: scenario.scenarioId,
    isEligible: true,
    originMs,
    requiredContextMs: 0,
  };
}

export function computeCandidateEligibilityMatrix(scenarios, candidates) {
  const candidateEligibleMap = {};
  for (const c of candidates) {
    const eligibleIds = scenarios
      .filter((s) => deriveScenarioEligibility(s, c.profileId).isEligible)
      .map((s) => s.scenarioId);
    candidateEligibleMap[c.candidateId] = {
      candidateId: c.candidateId,
      profileId: c.profileId,
      totalScheduled: scenarios.length,
      eligibleCount: eligibleIds.length,
      eligibleScenarioIds: eligibleIds,
    };
  }
  return candidateEligibleMap;
}

export function createProductionExecutionManifest(rawScenarios) {
  return rawScenarios.map((s) => {
    const sc = {
      scenarioId: s.scenarioId,
      split: s.split ?? 'BLIND',
      performerId: s.performerId ?? s.scenarioId.split(':').pop()?.replace(/^performer_/, ''),
      audio: {
        nativeSampleRateHz: s.audio?.nativeSampleRateHz ?? 16000,
        channelPolicy: s.audio?.channelPolicy ?? 'MONO',
        clipStartMs: s.audio?.clipStartMs ?? 0,
        clipEndMs: s.audio?.clipEndMs ?? 15000,
        performanceOriginSourceMs: s.audio?.performanceOriginSourceMs ?? s.performanceOriginSourceMs ?? 0,
        sourceDurationMs: s.audio?.sourceDurationMs ?? s.audio?.clipEndMs ?? 15000,
        sourceSampleCount: s.audio?.sourceSampleCount,
      },
      source: {
        sourceAudioPath: s.source?.sourceAudioPath,
        sourceAudioSha256: s.source?.sourceAudioSha256,
        sourcePcmSha256: s.source?.sourcePcmSha256,
        isSyntheticFixture: false,
      },
    };
    challengerQual.assertProductionAudioManifestValid(sc);
    return sc;
  });
}

export function createSyntheticRehearsalManifest(fixtures) {
  return fixtures.map((f) => {
    const sc = {
      scenarioId: f.scenarioId,
      split: 'SYNTHETIC_REHEARSAL',
      isSynthetic: true,
      audio: {
        nativeSampleRateHz: f.sampleRateHz ?? f.audio?.nativeSampleRateHz ?? 16000,
        channelPolicy: 'MONO',
        clipStartMs: f.clipStartMs ?? f.audio?.clipStartMs ?? 0,
        clipEndMs: f.durationMs ?? f.audio?.clipEndMs ?? 15000,
        performanceOriginSourceMs: f.performanceOriginSourceMs ?? f.audio?.performanceOriginSourceMs ?? 5000,
        sourceDurationMs: f.durationMs ?? f.audio?.sourceDurationMs ?? 15000,
        sourceSampleCount: f.sampleCount ?? f.audio?.sourceSampleCount,
      },
      source: {
        sourceAudioPath: f.audioPath ?? f.source?.sourceAudioPath,
        sourceAudioSha256: f.audioSha256 ?? f.source?.sourceAudioSha256,
        sourcePcmSha256: f.pcmSha256 ?? f.source?.sourcePcmSha256,
        isSyntheticFixture: true,
      },
    };
    challengerQual.assertSyntheticRehearsalManifestValid(sc);
    return sc;
  });
}

export function createSanitizedAcousticManifest(scenarios) {
  const isSynthetic = scenarios.some((s) => s.isSynthetic || s.scenarioId?.includes('synthetic') || s.split === 'SYNTHETIC_REHEARSAL');
  if (isSynthetic) {
    return createSyntheticRehearsalManifest(scenarios);
  }
  return createProductionExecutionManifest(scenarios);
}


// ---------------------------------------------------------------------------
// Layer 2: Exclusive Atomic Run Lock & Cryptographic Event Journal
// ---------------------------------------------------------------------------

export class DurableExecutionLedger {
  constructor(baseDir, runId) {
    this.runId = runId;
    this.runDir = path.resolve(baseDir, runId);
    this.lockPath = path.resolve(this.runDir, 'run.lock');
    this.writerLockPath = path.resolve(this.runDir, 'writer.lock');
    this.journalPath = path.resolve(this.runDir, 'journal.jsonl');
    this.ledgerPath = path.resolve(this.runDir, 'execution_ledger.json');
    this.evidenceDir = path.resolve(this.runDir, 'evidence');

    this.state = 'PREPARED';
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.records = new Map(); // key: `${candidateId}\0${scenarioId}` => record
    this.journalEvents = [];
    this.activeAttempts = new Map(); // candidateId:scenarioId => startTime
  }

  async init(options = {}) {
    await mkdir(this.runDir, { recursive: true });
    await mkdir(this.evidenceDir, { recursive: true });

    const lockExists = existsSync(this.lockPath);
    if (!lockExists) {
      // Exclusive atomic run reservation using 'wx' flag
      let fd;
      try {
        fd = openSync(this.lockPath, 'wx');
      } catch (err) {
        if (err.code === 'EEXIST') {
          throw new Error(`CONCURRENT_RUN_LOCK_COLLISION:${this.runId}`);
        }
        throw err;
      }
      const lockData = {
        runId: this.runId,
        pid: process.pid,
        createdAt: this.createdAt,
        protocolSha256: options.protocolSha256,
        scorerSha256: options.scorerSha256,
        orchestratorSha256: options.orchestratorSha256,
        rosterSha256: options.rosterSha256,
        manifestSha256: options.manifestSha256,
      };
      appendFileSync(fd, JSON.stringify(lockData, null, 2) + '\n', 'utf8');
      closeSync(fd);

      // Acquire exclusive writer ownership
      let writerFd;
      try {
        writerFd = openSync(this.writerLockPath, 'wx');
      } catch (err) {
        if (err.code === 'EEXIST') {
          throw new Error(`CONCURRENT_WRITER_COLLISION:${this.runId}`);
        }
        throw err;
      }
      const writerData = {
        runId: this.runId,
        pid: process.pid,
        acquiredAt: this.createdAt,
      };
      appendFileSync(writerFd, JSON.stringify(writerData, null, 2) + '\n', 'utf8');
      closeSync(writerFd);

      // Initialize append-only journal with genesis event
      this.appendJournalEvent('RUN_INITIALIZED', {
        runId: this.runId,
        pid: process.pid,
        bindings: lockData,
      });

      await this.persistLedger();
      return;
    }

    // Lock exists
    if (!options.allowResume) {
      throw new Error(`DUPLICATE_RUN_ID_REJECTED:${this.runId}`);
    }

    // Resume execution: acquire exclusive resume writer ownership
    let writerFd;
    try {
      writerFd = openSync(this.writerLockPath, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw new Error(`CONCURRENT_RESUME_WRITER_COLLISION:${this.runId}`);
      }
      throw err;
    }
    const writerData = {
      runId: this.runId,
      pid: process.pid,
      resumedAt: new Date().toISOString(),
    };
    appendFileSync(writerFd, JSON.stringify(writerData, null, 2) + '\n', 'utf8');
    closeSync(writerFd);

    // Resume execution: validate existing lock and replay journal
    try {
      const lockRaw = JSON.parse(readFileSync(this.lockPath, 'utf8'));
      if (lockRaw.runId !== this.runId) {
        throw new Error(`LEDGER_RUN_ID_MISMATCH:${lockRaw.runId} !== ${this.runId}`);
      }
      if (options.protocolSha256 && lockRaw.protocolSha256 && lockRaw.protocolSha256 !== options.protocolSha256) {
        throw new Error(`RESUME_BLOCKED_PROTOCOL_SHA_CHANGED:${lockRaw.protocolSha256} !== ${options.protocolSha256}`);
      }
      if (options.scorerSha256 && lockRaw.scorerSha256 && lockRaw.scorerSha256 !== options.scorerSha256) {
        throw new Error(`RESUME_BLOCKED_SCORER_SHA_CHANGED:${lockRaw.scorerSha256} !== ${options.scorerSha256}`);
      }
      if (options.orchestratorSha256 && lockRaw.orchestratorSha256 && lockRaw.orchestratorSha256 !== options.orchestratorSha256) {
        throw new Error(`RESUME_BLOCKED_ORCHESTRATOR_SHA_CHANGED:${lockRaw.orchestratorSha256} !== ${options.orchestratorSha256}`);
      }
      if (options.rosterSha256 && lockRaw.rosterSha256 && lockRaw.rosterSha256 !== options.rosterSha256) {
        throw new Error(`RESUME_BLOCKED_ROSTER_SHA_CHANGED:${lockRaw.rosterSha256} !== ${options.rosterSha256}`);
      }
      if (options.manifestSha256 && lockRaw.manifestSha256 && lockRaw.manifestSha256 !== options.manifestSha256) {
        throw new Error(`RESUME_BLOCKED_MANIFEST_SHA_CHANGED:${lockRaw.manifestSha256} !== ${options.manifestSha256}`);
      }

      this.replayJournal();

      // Handle uncertain outcomes: any attempt that started but never committed or failed
      for (const [key, startTime] of this.activeAttempts.entries()) {
        const [candId, scId] = key.split('\0');
        if (!this.records.has(key)) {
          this.appendJournalEvent('ATTEMPT_OUTCOME_UNKNOWN', {
            candidateId: candId,
            scenarioId: scId,
            startTimeMs: startTime,
            interruptedAt: new Date().toISOString(),
            reason: 'CRASH_BEFORE_EVIDENCE_COMMIT_DETECTED_ON_RESUME',
          });
          const unknownRecord = {
            candidateId: candId,
            scenarioId: scId,
            status: 'ATTEMPT_OUTCOME_UNKNOWN',
            recordedAt: new Date().toISOString(),
            failureReason: 'CRASH_BEFORE_EVIDENCE_COMMIT_DETECTED_ON_RESUME',
          };
          this.records.set(key, unknownRecord);
        }
      }
      this.activeAttempts.clear();
      await this.persistLedger();
    } catch (err) {
      this.releaseWriterLock();
      throw err;
    }
  }

  appendJournalEvent(eventType, payload) {
    const seq = this.journalEvents.length;
    const prevEventHash = seq === 0
      ? '0'.repeat(64)
      : this.journalEvents[seq - 1].eventHash;
    const timestamp = new Date().toISOString();

    const unsignedContent = {
      seq,
      prevEventHash,
      timestamp,
      eventType,
      runId: this.runId,
      payload,
    };
    const eventHash = sha256Json(unsignedContent);
    const event = { ...unsignedContent, eventHash };

    appendFileSync(this.journalPath, JSON.stringify(event) + '\n', 'utf8');
    this.journalEvents.push(event);
    this.updatedAt = timestamp;
    return event;
  }

  replayJournal() {
    if (!existsSync(this.journalPath)) return;
    const lines = readFileSync(this.journalPath, 'utf8').trim().split('\n').filter(Boolean);
    this.journalEvents = lines.map((line) => JSON.parse(line));

    challengerQual.assertJournalEventChainValid(this.journalEvents);

    this.records.clear();
    this.activeAttempts.clear();

    for (const ev of this.journalEvents) {
      if (ev.eventType === 'STATE_TRANSITION') {
        this.state = ev.payload.toState;
      } else if (ev.eventType === 'ATTEMPT_STARTED') {
        const key = `${ev.payload.candidateId}\0${ev.payload.scenarioId}`;
        this.activeAttempts.set(key, ev.payload.startTimeMs);
      } else if (ev.eventType === 'ATTEMPT_COMMITTED') {
        const key = `${ev.payload.candidateId}\0${ev.payload.scenarioId}`;
        this.activeAttempts.delete(key);
        this.records.set(key, ev.payload);
      } else if (ev.eventType === 'ATTEMPT_FAILED' || ev.eventType === 'ATTEMPT_BLOCKED' || ev.eventType === 'ATTEMPT_OUTCOME_UNKNOWN') {
        const key = `${ev.payload.candidateId}\0${ev.payload.scenarioId}`;
        this.activeAttempts.delete(key);
        this.records.set(key, ev.payload);
      }
    }
  }

  transitionTo(nextState) {
    challengerQual.assertLedgerStateTransitionValid(this.state, nextState);
    const prevState = this.state;
    this.state = nextState;
    this.appendJournalEvent('STATE_TRANSITION', { fromState: prevState, toState: nextState });
    this.persistLedgerSync();
  }

  startAttempt(candidateId, scenarioId) {
    if (this.state !== 'RUNNING') {
      throw new Error(`LEDGER_NOT_IN_RUNNING_STATE:${this.state}`);
    }
    const key = `${candidateId}\0${scenarioId}`;
    if (this.records.has(key)) {
      throw new Error(`DUPLICATE_CANDIDATE_SCENARIO_RUN_REJECTED:${candidateId}:${scenarioId}`);
    }
    this.activeAttempts.set(key, Date.now());
    this.appendJournalEvent('ATTEMPT_STARTED', {
      candidateId,
      scenarioId,
      startTimeMs: Date.now(),
    });
  }

  async commitAttempt(attemptRecord, evidenceBlob) {
    if (this.state !== 'RUNNING') {
      throw new Error(`LEDGER_NOT_IN_RUNNING_STATE:${this.state}`);
    }
    const key = `${attemptRecord.candidateId}\0${attemptRecord.scenarioId}`;
    if (this.records.has(key)) {
      throw new Error(`RECORD_ALREADY_COMMITTED_CANNOT_OVERWRITE:${attemptRecord.candidateId}:${attemptRecord.scenarioId}`);
    }

    // 1. Durably write evidence blob atomically (sanitize colons for Windows paths)
    const safeCandId = attemptRecord.candidateId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScId = attemptRecord.scenarioId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const evidencePath = path.resolve(this.evidenceDir, `${safeCandId}__${safeScId}.json`);
    if (existsSync(evidencePath)) {
      throw new Error(`EVIDENCE_FILE_ALREADY_EXISTS_CANNOT_OVERWRITE:${evidencePath}`);
    }
    await atomicWriteJson(evidencePath, evidenceBlob);

    // 2. Append commit event to journal
    this.appendJournalEvent('ATTEMPT_COMMITTED', {
      ...attemptRecord,
      evidencePath: path.relative(this.runDir, evidencePath),
      evidenceSha256: evidenceBlob.evidenceRecordSha256,
    });

    this.activeAttempts.delete(key);
    this.records.set(key, attemptRecord);

    // 3. Atomically update ledger snapshot
    await this.persistLedger();
  }

  recordFailedAttempt(candidateId, scenarioId, errorDetails) {
    const key = `${candidateId}\0${scenarioId}`;
    this.activeAttempts.delete(key);
    const failedRecord = {
      candidateId,
      scenarioId,
      status: 'FAILED',
      recordedAt: new Date().toISOString(),
      failureReason: errorDetails.message ?? String(errorDetails),
    };
    this.appendJournalEvent('ATTEMPT_FAILED', failedRecord);
    this.records.set(key, failedRecord);
    this.persistLedgerSync();
  }

  getRecord(candidateId, scenarioId) {
    return this.records.get(`${candidateId}\0${scenarioId}`);
  }

  hasRecord(candidateId, scenarioId) {
    return this.records.has(`${candidateId}\0${scenarioId}`);
  }

  readCommittedEvidence(candidateId, scenarioId) {
    const safeCandId = candidateId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeScId = scenarioId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const evidencePath = path.resolve(this.evidenceDir, `${safeCandId}__${safeScId}.json`);
    if (!existsSync(evidencePath)) {
      throw new Error(`COMMITTED_EVIDENCE_NOT_FOUND_ON_DISK:${candidateId}:${scenarioId}`);
    }
    const raw = readFileSync(evidencePath, 'utf8');
    const blob = JSON.parse(raw);

    // Verify evidence blob integrity
    if (blob.candidateId !== candidateId || blob.scenarioId !== scenarioId) {
      throw new Error(`EVIDENCE_IDENTITY_MISMATCH:${candidateId}:${scenarioId}`);
    }
    const recomputedObservationDigest = sha256Json(blob.publications);
    if (blob.observationDigest !== recomputedObservationDigest) {
      throw new Error(`EVIDENCE_OBSERVATION_DIGEST_CORRUPTED:${candidateId}:${scenarioId}`);
    }
    const record = this.records.get(`${candidateId}\0${scenarioId}`);
    if (record) {
      if (record.evidenceSha256 && record.evidenceSha256 !== blob.evidenceRecordSha256) {
        throw new Error(`EVIDENCE_SHA256_MISMATCH_WITH_LEDGER:${blob.evidenceRecordSha256} !== ${record.evidenceSha256}`);
      }
      if (record.acousticOutputDigest && record.acousticOutputDigest !== blob.observationDigest) {
        throw new Error(`EVIDENCE_DIGEST_MISMATCH_WITH_LEDGER:${blob.observationDigest} !== ${record.acousticOutputDigest}`);
      }
    }
    return blob;
  }

  persistLedgerSync() {
    const payload = {
      schemaVersion: 2,
      artifact: 'phase9gb_durable_execution_ledger',
      runId: this.runId,
      state: this.state,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      recordCount: this.records.size,
      records: Array.from(this.records.values()),
    };
    const tmpPath = `${this.ledgerPath}.${process.pid}.tmp`;
    appendFileSync(tmpPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    renameSync(tmpPath, this.ledgerPath);
  }

  async persistLedger() {
    const payload = {
      schemaVersion: 2,
      artifact: 'phase9gb_durable_execution_ledger',
      runId: this.runId,
      state: this.state,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      recordCount: this.records.size,
      records: Array.from(this.records.values()),
    };
    await atomicWriteJson(this.ledgerPath, payload);
  }

  releaseWriterLock() {
    if (existsSync(this.writerLockPath)) {
      try {
        unlinkSync(this.writerLockPath);
      } catch {}
    }
  }

  close() {
    this.releaseWriterLock();
  }
}

// ---------------------------------------------------------------------------
// Layer 3: Mandatory Pre-Inference Guard & Causal Publication Validation
// ---------------------------------------------------------------------------

export function preflightCandidateScenarioExecution({
  protocolId,
  protocolSha256,
  expectedProtocolSha256,
  candidateConfig,
  sanitizedScenario,
  ledger,
  authorizedScenarioIds,
}) {
  // 1. Strict schema isolation: ensure NO ExpectedStrike truth or hidden notes reach inference
  if (sanitizedScenario.expectedStrikes || sanitizedScenario.physicalGroundTruth) {
    throw new Error('PREFLIGHT_GROUND_TRUTH_LEAKAGE_DETECTED: Sanitized scenario contains ExpectedStrike or physicalGroundTruth');
  }
  if (sanitizedScenario.taxonomy?.strikes || sanitizedScenario.notes) {
    throw new Error('PREFLIGHT_GROUND_TRUTH_LEAKAGE_DETECTED: Nested note or strike metadata present');
  }

  // 2. Validate protocol identity and mandatory trusted lock
  const allowedProtocolIds = [
    '9G-B-BLIND-V5',
    'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V5',
    '9G-B-BLIND-V4',
    'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V4',
  ];
  if (!allowedProtocolIds.includes(protocolId)) {
    throw new Error(`PREFLIGHT_PROTOCOL_ID_MISMATCH:${protocolId}`);
  }
  if (!protocolSha256 || protocolSha256.length !== 64) {
    throw new Error('PREFLIGHT_PROTOCOL_SHA_REQUIRED');
  }
  if (protocolSha256 === 'a'.repeat(64)) {
    throw new Error('PREFLIGHT_PROTOCOL_HASH_BYPASS_FORBIDDEN: dummy fallback hash rejected');
  }

  // Mandatory trusted protocol lock: cannot be omitted, cannot be self-authenticated
  const trustedSha = getTrustedProtocolSha256(protocolId);
  if (!trustedSha) {
    throw new Error(`PREFLIGHT_TRUSTED_PROTOCOL_LOCK_UNRESOLVED:${protocolId}`);
  }
  if (expectedProtocolSha256 && expectedProtocolSha256 !== trustedSha) {
    throw new Error(`PREFLIGHT_UNTRUSTED_EXPECTED_PROTOCOL_SHA:${expectedProtocolSha256} !== ${trustedSha}`);
  }
  if (protocolSha256 !== trustedSha) {
    throw new Error(`PREFLIGHT_PROTOCOL_SHA_MISMATCH: got ${protocolSha256}, expected ${trustedSha}`);
  }


  // 3. Validate candidate belongs to frozen 3-candidate roster
  const candidateId = candidateConfig.candidateId;
  const lockedSpec = FROZEN_RANKED_ROSTER[candidateId];
  if (!lockedSpec) {
    throw new Error(`UNAUTHORIZED_CANDIDATE_REJECTED_FROM_RANKED_BLIND_RUN:${candidateId}`);
  }

  // 4. Validate profile, config SHA, checkpoint SHA, and byte size
  if (candidateConfig.profileId !== lockedSpec.profileId) {
    throw new Error(`PREFLIGHT_PROFILE_MISMATCH:${candidateConfig.profileId} !== ${lockedSpec.profileId}`);
  }
  if (candidateConfig.configurationSha256 !== lockedSpec.configurationSha256) {
    throw new Error(`PREFLIGHT_CONFIGURATION_SHA_MISMATCH:${candidateConfig.configurationSha256} !== ${lockedSpec.configurationSha256}`);
  }
  if (candidateConfig.checkpointSha256 !== lockedSpec.checkpointSha256) {
    throw new Error(`PREFLIGHT_CHECKPOINT_SHA_MISMATCH:${candidateConfig.checkpointSha256} !== ${lockedSpec.checkpointSha256}`);
  }
  const candBytes = candidateConfig.checkpointByteSize ?? candidateConfig.checkpointBytes;
  if (candBytes !== lockedSpec.checkpointBytes) {
    throw new Error(`PREFLIGHT_CHECKPOINT_BYTES_MISMATCH:${candBytes} !== ${lockedSpec.checkpointBytes}`);
  }

  // 5. Validate objective scenario eligibility from audio geometry
  const eligibility = deriveScenarioEligibility(sanitizedScenario, lockedSpec.profileId);
  if (!eligibility.isEligible) {
    throw new Error(`PREFLIGHT_SCENARIO_INELIGIBLE:${candidateId}:${sanitizedScenario.scenarioId}:${eligibility.exclusionReason}`);
  }

  // 6. Ensure audio file SHA and decoded PCM SHA are separate valid hashes
  if (!sanitizedScenario.source?.sourceAudioSha256 || sanitizedScenario.source.sourceAudioSha256.length !== 64) {
    throw new Error('PREFLIGHT_SOURCE_AUDIO_SHA_REQUIRED');
  }
  if (!sanitizedScenario.source?.sourcePcmSha256 || sanitizedScenario.source.sourcePcmSha256.length !== 64) {
    throw new Error('PREFLIGHT_SOURCE_PCM_SHA_REQUIRED');
  }

  // 7. Scenario allowlist and isolation check (MANDATORY)
  const performer = sanitizedScenario.scenarioId.split(':').pop()?.replace(/^performer_/, '');
  const isSynthetic = sanitizedScenario.scenarioId.includes('synthetic') || (sanitizedScenario.familyTags && sanitizedScenario.familyTags.includes('SYNTHETIC_REHEARSAL_FIXTURE'));
  if (!isSynthetic && (sanitizedScenario.split === 'BLIND' || sanitizedScenario.split === 'EVALUATION')) {
    if (performer && ['p07', 'p08', 'p09', 'p10', 'p11', 'p12', 'p13', 'p14'].includes(performer)) {
      throw new Error(`PREFLIGHT_CALIBRATION_PERFORMER_IN_BLIND_SPLIT_FORBIDDEN:${performer}`);
    }
  }

  if (!authorizedScenarioIds || (Array.isArray(authorizedScenarioIds) && authorizedScenarioIds.length === 0)) {
    throw new Error('PREFLIGHT_AUTHORIZED_SCENARIOS_REQUIRED: approved scenario allowlist is mandatory at execution entrypoint');
  }
  const idSet = Array.isArray(authorizedScenarioIds) ? new Set(authorizedScenarioIds) : authorizedScenarioIds;
  if (!idSet.has(sanitizedScenario.scenarioId)) {
    throw new Error(`PREFLIGHT_UNAUTHORIZED_SCENARIO_REJECTED:${sanitizedScenario.scenarioId}`);
  }

  // 8. Verify ledger state and duplicate check
  if (ledger.state !== 'RUNNING') {
    throw new Error(`PREFLIGHT_LEDGER_NOT_RUNNING:${ledger.state}`);
  }
  if (ledger.hasRecord(candidateId, sanitizedScenario.scenarioId)) {
    throw new Error(`PREFLIGHT_DUPLICATE_SCENARIO_ATTEMPT:${candidateId}:${sanitizedScenario.scenarioId}`);
  }
}

export function validateAcousticPublications(publications, scenarioAudio) {
  if (!Array.isArray(publications) || publications.length === 0) {
    throw new Error('EMPTY_PUBLICATIONS_REJECTED');
  }

  let prevAnalyzedMs = -1;
  for (const pub of publications) {
    challengerQual.assertAcousticPublicationCausalTimingValid(pub);

    if (pub.analyzedThroughPerformanceMs < prevAnalyzedMs) {
      throw new Error(`NON_MONOTONIC_PUBLICATION_SEQUENCE: ${pub.analyzedThroughPerformanceMs} < ${prevAnalyzedMs}`);
    }
    prevAnalyzedMs = pub.analyzedThroughPerformanceMs;

    // Boundary check against scenario clip bounds
    if (scenarioAudio?.clipEndMs && pub.analyzedThroughPerformanceMs > scenarioAudio.clipEndMs + 100) {
      throw new Error(`PUBLICATION_EXCEEDS_CLIP_BOUNDS:${pub.analyzedThroughPerformanceMs} > ${scenarioAudio.clipEndMs}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Layer 3 & 4: Execution & Evidence Commit
// ---------------------------------------------------------------------------

export async function executeAcousticCandidate(adapter, sanitizedScenario, candidateConfig, ledger, protocolMeta) {
  if (!protocolMeta || !protocolMeta.protocolId || !protocolMeta.protocolSha256) {
    throw new Error('PREFLIGHT_PROTOCOL_METADATA_REQUIRED: protocolId and protocolSha256 must be explicitly provided');
  }
  if (!protocolMeta.authorizedScenarioIds || (Array.isArray(protocolMeta.authorizedScenarioIds) && protocolMeta.authorizedScenarioIds.length === 0)) {
    throw new Error('PREFLIGHT_AUTHORIZED_SCENARIOS_REQUIRED: approved scenario allowlist is mandatory at execution entrypoint');
  }

  // 1. Mandatory preflight
  preflightCandidateScenarioExecution({
    protocolId: protocolMeta.protocolId,
    protocolSha256: protocolMeta.protocolSha256,
    expectedProtocolSha256: protocolMeta.expectedProtocolSha256,
    candidateConfig,
    sanitizedScenario,
    ledger,
    authorizedScenarioIds: protocolMeta.authorizedScenarioIds,
  });

  // 2. Mark attempt started in ledger journal
  ledger.startAttempt(candidateConfig.candidateId, sanitizedScenario.scenarioId);

  const startTime = Date.now();
  let runResult;
  try {
    runResult = await adapter.inferAcoustic(sanitizedScenario, candidateConfig);
  } catch (err) {
    ledger.recordFailedAttempt(candidateConfig.candidateId, sanitizedScenario.scenarioId, err);
    throw err;
  }
  const endTime = Date.now();

  // 3. Validate causal publication timing
  try {
    validateAcousticPublications(runResult.publications, sanitizedScenario.audio);
  } catch (err) {
    ledger.recordFailedAttempt(candidateConfig.candidateId, sanitizedScenario.scenarioId, err);
    throw err;
  }

  const observationDigest = sha256Json(runResult.publications);
  return {
    candidateId: candidateConfig.candidateId,
    scenarioId: sanitizedScenario.scenarioId,
    profileId: candidateConfig.profileId,
    configurationSha256: candidateConfig.configurationSha256,
    checkpointSha256: candidateConfig.checkpointSha256,
    checkpointByteSize: candidateConfig.checkpointByteSize,
    startTimeMs: startTime,
    endTimeMs: endTime,
    durationMs: endTime - startTime,
    sourceAudioSha256: sanitizedScenario.source.sourceAudioSha256,
    sourcePcmSha256: sanitizedScenario.source.sourcePcmSha256,
    acousticOutputDigest: observationDigest,
    publications: runResult.publications,
    exitCode: runResult.exitCode ?? 0,
    status: runResult.status ?? 'SUCCESS',
  };
}

export async function commitAcousticEvidence(ledger, executionResult, sanitizedScenario) {
  const evidenceRecord = {
    schemaVersion: 2,
    artifact: 'phase9gb_raw_acoustic_evidence_blob',
    candidateId: executionResult.candidateId,
    scenarioId: executionResult.scenarioId,
    profileId: executionResult.profileId,
    configurationSha256: executionResult.configurationSha256,
    checkpointSha256: executionResult.checkpointSha256,
    checkpointByteSize: executionResult.checkpointByteSize,
    sourceAudioSha256: executionResult.sourceAudioSha256,
    sourcePcmSha256: executionResult.sourcePcmSha256,
    sourceAudioPath: sanitizedScenario?.source?.sourceAudioPath ?? `audio/${executionResult.scenarioId}.wav`,
    clipStartMs: sanitizedScenario?.audio?.clipStartMs ?? 0,
    clipEndMs: sanitizedScenario?.audio?.clipEndMs ?? 15000,
    performanceOriginSourceMs: sanitizedScenario?.audio?.performanceOriginSourceMs ?? 0,
    executionTiming: {
      startTimeMs: executionResult.startTimeMs,
      endTimeMs: executionResult.endTimeMs,
      durationMs: executionResult.durationMs,
    },
    runtimeIdentity: 'noteverse-research-runtime-v3',
    observationDigest: executionResult.acousticOutputDigest,
    publications: executionResult.publications,
    exitCode: executionResult.exitCode,
    status: executionResult.status,
  };

  evidenceRecord.evidenceRecordSha256 = sha256Json(evidenceRecord);

  const attemptSummary = {
    candidateId: executionResult.candidateId,
    scenarioId: executionResult.scenarioId,
    checkpointSha256: executionResult.checkpointSha256,
    startTimeMs: executionResult.startTimeMs,
    endTimeMs: executionResult.endTimeMs,
    durationMs: executionResult.durationMs,
    sourceAudioSha256: executionResult.sourceAudioSha256,
    sourcePcmSha256: executionResult.sourcePcmSha256,
    acousticOutputDigest: executionResult.acousticOutputDigest,
    evidenceSha256: evidenceRecord.evidenceRecordSha256,
    exitCode: executionResult.exitCode,
    status: executionResult.status,
  };

  await ledger.commitAttempt(attemptSummary, evidenceRecord);
  return evidenceRecord;
}

// ---------------------------------------------------------------------------
// Layer 5: Shared Scorer Invocation Reading Strictly From Disk Evidence
// ---------------------------------------------------------------------------

export function scoreCommittedAcousticOutput(ledger, fullScenarioWithTruth, candidateDef) {
  // 1. Read committed evidence blob from disk
  const evidenceBlob = ledger.readCommittedEvidence(candidateDef.candidateId, fullScenarioWithTruth.scenarioId);

  // 2. Validate ledger record matches disk blob
  const record = ledger.getRecord(candidateDef.candidateId, fullScenarioWithTruth.scenarioId);
  if (!record || record.status !== 'SUCCESS') {
    throw new Error(`UNCOMMITTED_EVIDENCE_CANNOT_BE_SCORED:${candidateDef.candidateId}:${fullScenarioWithTruth.scenarioId}`);
  }
  if (record.acousticOutputDigest !== evidenceBlob.observationDigest) {
    throw new Error(`ACOUSTIC_DIGEST_MISMATCH_ON_SCORING:${candidateDef.candidateId}:${fullScenarioWithTruth.scenarioId}`);
  }
  if (record.evidenceSha256 && record.evidenceSha256 !== evidenceBlob.evidenceRecordSha256) {
    throw new Error(`EVIDENCE_SHA256_MISMATCH_ON_SCORING:${candidateDef.candidateId}:${fullScenarioWithTruth.scenarioId}`);
  }

  // 3. Construct candidate run exclusively from disk-loaded publications
  const candidateScenarioRun = {
    candidateId: candidateDef.candidateId,
    scenarioId: fullScenarioWithTruth.scenarioId,
    publications: evidenceBlob.publications,
  };

  return bakeoffScorer.scoreCandidate(fullScenarioWithTruth, candidateDef, candidateScenarioRun);
}

// ---------------------------------------------------------------------------
// Layer 6: Statistical Paired Bootstrap & Symmetric Safety Hierarchy
// ---------------------------------------------------------------------------

export function computeSeededBootstrapCi(diffs, seed = 13371, draws = 5000, confidence = 0.95) {
  if (diffs.length === 0) {
    return { low: 0, high: 0, mean: 0 };
  }
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;

  let state = seed >>> 0;
  function lcg() {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  }

  const means = [];
  const n = diffs.length;
  for (let d = 0; d < draws; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(lcg() * n);
      sum += diffs[idx];
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const alpha = (1 - confidence) / 2;
  const lowIdx = Math.floor(alpha * draws);
  const highIdx = Math.ceil((1 - alpha) * draws) - 1;
  return {
    mean,
    low: means[lowIdx],
    high: means[highIdx],
    seed,
    draws,
    confidenceLevel: confidence,
  };
}

export function evaluateSafetyHierarchyDominance(diffVectorsByMetric, options = {}) {
  return challengerQual.evaluateSymmetricSafetyDominance(
    diffVectorsByMetric,
    (diffs) => computeSeededBootstrapCi(diffs),
    options,
  );
}

// ---------------------------------------------------------------------------
// Layer 7: Metric Vector Extraction, Coverage Derivation & Independent Audit
// ---------------------------------------------------------------------------

export function buildPairwiseCandidateMetricVectors(candidateAScores, candidateBScores, metricNames) {
  const scoreMapA = new Map();
  for (const s of candidateAScores) {
    scoreMapA.set(s.scenarioId, s);
  }
  const scoreMapB = new Map();
  for (const s of candidateBScores) {
    scoreMapB.set(s.scenarioId, s);
  }

  // Find common scenarios
  const commonScenarioIds = [];
  for (const scId of scoreMapA.keys()) {
    if (scoreMapB.has(scId)) {
      commonScenarioIds.push(scId);
    }
  }

  const diffVectorsByMetric = {};
  const validCountsByMetric = {};

  for (const metric of metricNames) {
    const diffs = [];
    for (const scId of commonScenarioIds) {
      const recA = scoreMapA.get(scId);
      const recB = scoreMapB.get(scId);
      const mA = recA?.metrics?.[metric];
      const mB = recB?.metrics?.[metric];

      if (mA && mB && mA.status === 'MEASURED' && mB.status === 'MEASURED') {
        const valA = typeof mA.value === 'number' ? mA.value : mA.mean;
        const valB = typeof mB.value === 'number' ? mB.value : mB.mean;
        if (Number.isFinite(valA) && Number.isFinite(valB)) {
          diffs.push(valA - valB);
        }
      }
    }
    diffVectorsByMetric[metric] = diffs;
    validCountsByMetric[metric] = diffs.length;
  }

  return {
    diffVectorsByMetric,
    validCountsByMetric,
    candidateAScenarioCount: candidateAScores.length,
    candidateBScenarioCount: candidateBScores.length,
    pairedScenarioCount: commonScenarioIds.length,
  };
}

export function evaluateProductionExecutionCoverage(ledger, scenarios, candidateRoster) {
  const candidateCoverage = {};
  let totalEligible = 0;
  let totalCompleted = 0;
  let totalFailed = 0;
  let totalUncertain = 0;
  let totalMissing = 0;

  for (const cand of candidateRoster) {
    const eligibleScenarios = scenarios.filter((s) => deriveScenarioEligibility(s, cand.profileId).isEligible);
    let completed = 0;
    let failed = 0;
    let uncertain = 0;
    let missing = 0;

    for (const sc of eligibleScenarios) {
      const rec = ledger.getRecord(cand.candidateId, sc.scenarioId);
      if (!rec) {
        missing++;
      } else if (rec.status === 'SUCCESS') {
        completed++;
      } else if (rec.status === 'FAILED') {
        failed++;
      } else if (rec.status === 'ATTEMPT_OUTCOME_UNKNOWN') {
        uncertain++;
      } else {
        missing++;
      }
    }

    const coverageFraction = eligibleScenarios.length > 0 ? completed / eligibleScenarios.length : 0;
    candidateCoverage[cand.candidateId] = {
      candidateId: cand.candidateId,
      eligibleCount: eligibleScenarios.length,
      completedCount: completed,
      failedCount: failed,
      uncertainCount: uncertain,
      missingCount: missing,
      coveragePercent: coverageFraction * 100,
    };

    totalEligible += eligibleScenarios.length;
    totalCompleted += completed;
    totalFailed += failed;
    totalUncertain += uncertain;
    totalMissing += missing;
  }

  const overallFraction = totalEligible > 0 ? totalCompleted / totalEligible : 0;
  const isComplete = totalCompleted === totalEligible && totalFailed === 0 && totalUncertain === 0 && totalMissing === 0;

  return {
    isComplete,
    totalEligible,
    totalCompleted,
    totalFailed,
    totalUncertain,
    totalMissing,
    overallCoveragePercent: overallFraction * 100,
    candidateCoverage,
    coverageOutcome: isComplete ? 'EVALUATION_COVERAGE_COMPLETE' : 'EVALUATION_INCOMPLETE_NO_WINNER',
  };
}

export async function independentlyVerifyAndScoreCommittedEvidence(runDir, fullScenariosWithTruth, candidateDefs, options = {}) {
  const journalPath = path.resolve(runDir, 'journal.jsonl');
  if (!existsSync(journalPath)) {
    throw new Error(`JOURNAL_NOT_FOUND_FOR_AUDIT:${journalPath}`);
  }
  const lines = readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map((l) => JSON.parse(l));

  // 1. Verify journal event chain cryptographic integrity
  challengerQual.assertJournalEventChainValid(events);

  // 2. Journal completeness verification: require trusted chain tip anchor
  const receiptPath = path.resolve(runDir, 'run_receipt.json');
  let trustedAnchor = null;
  if (existsSync(receiptPath)) {
    trustedAnchor = JSON.parse(readFileSync(receiptPath, 'utf8'));
  } else if (options.expectedReceipt) {
    trustedAnchor = options.expectedReceipt;
  } else if (options.expectedChainTip) {
    trustedAnchor = { chainTipHash: options.expectedChainTip, eventCount: options.expectedEventCount };
  }

  if (!trustedAnchor || !trustedAnchor.chainTipHash) {
    throw new Error('JOURNAL_COMPLETENESS_NOT_VERIFIABLE: Missing trusted journal chain-tip anchor or run receipt');
  }
  challengerQual.assertJournalChainTipAndCompleteness(events, trustedAnchor);

  // 3. For each committed attempt, independently verify evidence on disk
  const scenariosById = new Map(fullScenariosWithTruth.map((s) => [s.scenarioId, s]));
  const candDefsById = new Map(candidateDefs.map((c) => [c.candidateId, c]));
  const verifiedScores = [];

  for (const ev of events) {
    if (ev.eventType === 'ATTEMPT_COMMITTED') {
      const payload = ev.payload;
      const safeCandId = payload.candidateId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeScId = payload.scenarioId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const evidencePath = path.resolve(runDir, 'evidence', `${safeCandId}__${safeScId}.json`);
      if (!existsSync(evidencePath)) {
        throw new Error(`COMMITTED_EVIDENCE_MISSING_FROM_DISK:${evidencePath}`);
      }
      const raw = readFileSync(evidencePath, 'utf8');
      const blob = JSON.parse(raw);

      // Verify SHA256 matches journal
      const unsignedBlob = { ...blob };
      delete unsignedBlob.evidenceRecordSha256;
      const blobSha = sha256Json(unsignedBlob);
      if (blob.evidenceRecordSha256 !== blobSha) {
        throw new Error(`EVIDENCE_RECORD_SELF_SHA_MISMATCH:${blob.evidenceRecordSha256} !== ${blobSha}`);
      }
      if (payload.evidenceSha256 && payload.evidenceSha256 !== blobSha) {
        throw new Error(`EVIDENCE_SHA_MISMATCH_WITH_JOURNAL:${payload.evidenceSha256} !== ${blobSha}`);
      }

      // Verify observation digest
      const recomputedDigest = sha256Json(blob.publications);
      if (recomputedDigest !== blob.observationDigest || recomputedDigest !== payload.acousticOutputDigest) {
        throw new Error(`EVIDENCE_OBSERVATION_DIGEST_MISMATCH:${blob.observationDigest} !== ${recomputedDigest}`);
      }

      const fullScenario = scenariosById.get(payload.scenarioId);
      const candDef = candDefsById.get(payload.candidateId);
      if (fullScenario && candDef) {
        const candidateRun = {
          candidateId: candDef.candidateId,
          scenarioId: fullScenario.scenarioId,
          publications: blob.publications,
        };
        const score = bakeoffScorer.scoreCandidate(fullScenario, candDef, candidateRun);
        verifiedScores.push(score);
      }
    }
  }

  return {
    verifiedJournal: true,
    totalEvents: events.length,
    totalAttemptsVerified: verifiedScores.length,
    verifiedScores,
  };
}
