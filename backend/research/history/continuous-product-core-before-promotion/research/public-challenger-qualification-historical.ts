/**
 * Phase 9G-B Historical/Archived Qualification Machinery.
 *
 * Contains archived protocol identity assertions (V2-V7), execution locks,
 * cryptographic authorization receipts, journal hash-chaining verification,
 * and ledger state transition rules retired during Phase 9G-B.3-PREP.
 *
 * Preserved for research provenance and historical unit tests.
 * Active benchmark execution must not depend on this module.
 */

import { createHash, verify } from 'node:crypto';
import {
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V1_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6_SHA256,
  PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V7,
  PHASE_9GB_BLIND_MANIFEST_SHA256,
} from './public-challenger-qualification';

export function assertBlindProtocolV2Identity(identity: {
  policyId: string;
  schemaVersion: number;
  sha256?: string;
  supersedesPolicySha256?: string;
}): void {
  if (identity.policyId !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2) {
    throw new Error(`BLIND_PROTOCOL_V2_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== 2) {
    throw new Error(`BLIND_PROTOCOL_V2_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
  }
  if (!identity.sha256 || identity.sha256.length !== 64) {
    throw new Error('BLIND_PROTOCOL_V2_SHA_REQUIRED');
  }
  if (identity.supersedesPolicySha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V1_SHA256) {
    throw new Error(`BLIND_PROTOCOL_V2_SUPERSEDED_POLICY_SHA_MISMATCH:${identity.supersedesPolicySha256}`);
  }
}

export interface ExecutionLockBindings {
  readonly scorerSha256: string;
  readonly finalizerSha256: string;
  readonly orchestratorSha256: string;
  readonly candidateCheckpoints: Record<string, { sha256: string; bytes: number }>;
  readonly runtimeDigests: Record<string, string>;
}

export function assertExecutionLockBindingsValid(bindings: ExecutionLockBindings): void {
  const isHex64 = (s: string) => typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
  if (!isHex64(bindings.scorerSha256)) throw new Error('INVALID_EXECUTION_LOCK_SCORER_SHA');
  if (!isHex64(bindings.finalizerSha256)) throw new Error('INVALID_EXECUTION_LOCK_FINALIZER_SHA');
  if (!isHex64(bindings.orchestratorSha256)) throw new Error('INVALID_EXECUTION_LOCK_ORCHESTRATOR_SHA');

  for (const [candId, cp] of Object.entries(bindings.candidateCheckpoints)) {
    if (!isHex64(cp.sha256)) throw new Error(`INVALID_CHECKPOINT_SHA:${candId}`);
    if (typeof cp.bytes !== 'number' || cp.bytes <= 0) throw new Error(`INVALID_CHECKPOINT_BYTES:${candId}`);
  }

  for (const [candId, digest] of Object.entries(bindings.runtimeDigests)) {
    if (!digest || typeof digest !== 'string') throw new Error(`INVALID_RUNTIME_DIGEST:${candId}`);
  }
}

export const VALID_LEDGER_STATES = ['PREPARED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'INCOMPLETE'] as const;
export type LedgerState = typeof VALID_LEDGER_STATES[number];

export function assertLedgerStateTransitionValid(current: LedgerState, next: LedgerState): void {
  const allowedTransitions: Record<LedgerState, readonly LedgerState[]> = {
    PREPARED: ['RUNNING', 'BLOCKED'],
    RUNNING: ['COMPLETED', 'FAILED', 'INCOMPLETE', 'BLOCKED'],
    INCOMPLETE: ['RUNNING', 'FAILED', 'BLOCKED'],
    COMPLETED: [],
    FAILED: [],
    BLOCKED: [],
  };
  const targets = allowedTransitions[current] ?? [];
  if (!targets.includes(next)) {
    throw new Error(`INVALID_LEDGER_STATE_TRANSITION:${current}->${next}`);
  }
}

export function assertNoDuplicateRunAttempt(existingRunIds: Set<string>, newRunId: string): void {
  if (existingRunIds.has(newRunId)) {
    throw new Error(`DUPLICATE_RUN_ID_REJECTED:${newRunId}`);
  }
}

export function assertNoDuplicateCandidateScenarioAttempt(existingKeys: Set<string>, candidateId: string, scenarioId: string): void {
  const key = `${candidateId}\0${scenarioId}`;
  if (existingKeys.has(key)) {
    throw new Error(`DUPLICATE_CANDIDATE_SCENARIO_RUN_REJECTED:${candidateId}:${scenarioId}`);
  }
}

export function assertBlindProtocolV3Identity(identity: {
  policyId: string;
  schemaVersion: number;
  sha256?: string;
  supersedesPolicySha256?: string;
}): void {
  if (identity.policyId !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3) {
    throw new Error(`BLIND_PROTOCOL_V3_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== 3) {
    throw new Error(`BLIND_PROTOCOL_V3_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
  }
  if (!identity.sha256 || identity.sha256.length !== 64) {
    throw new Error('BLIND_PROTOCOL_V3_SHA_REQUIRED');
  }
  if (identity.supersedesPolicySha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V2_SHA256) {
    throw new Error(`BLIND_PROTOCOL_V3_SUPERSEDED_POLICY_SHA_MISMATCH:${identity.supersedesPolicySha256}`);
  }
}

export function assertBlindProtocolV4Identity(identity: {
  policyId: string;
  schemaVersion: number;
  sha256?: string;
  supersedesPolicySha256?: string;
}): void {
  if (identity.policyId !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4) {
    throw new Error(`BLIND_PROTOCOL_V4_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== 4) {
    throw new Error(`BLIND_PROTOCOL_V4_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
  }
  if (!identity.sha256 || identity.sha256.length !== 64) {
    throw new Error('BLIND_PROTOCOL_V4_SHA_REQUIRED');
  }
  if (identity.supersedesPolicySha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V3_SHA256) {
    throw new Error(`BLIND_PROTOCOL_V4_SUPERSEDED_POLICY_SHA_MISMATCH:${identity.supersedesPolicySha256}`);
  }
}

export function assertBlindProtocolV5Identity(identity: {
  policyId: string;
  schemaVersion: number;
  sha256?: string;
  supersedesPolicySha256?: string;
}): void {
  if (identity.policyId !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5 && identity.policyId !== 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V5') {
    throw new Error(`BLIND_PROTOCOL_V5_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== 5) {
    throw new Error(`BLIND_PROTOCOL_V5_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
  }
  if (!identity.sha256 || identity.sha256.length !== 64) {
    throw new Error('BLIND_PROTOCOL_V5_SHA_REQUIRED');
  }
  if (identity.supersedesPolicySha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V4_SHA256) {
    throw new Error(`BLIND_PROTOCOL_V5_SUPERSEDED_POLICY_SHA_MISMATCH:${identity.supersedesPolicySha256}`);
  }
}

export function assertBlindProtocolV6Identity(identity: {
  policyId: string;
  schemaVersion: number;
  sha256?: string;
  supersedesPolicySha256?: string;
}): void {
  if (identity.policyId !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6 && identity.policyId !== 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V6') {
    throw new Error(`BLIND_PROTOCOL_V6_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== 6) {
    throw new Error(`BLIND_PROTOCOL_V6_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
  }
  if (!identity.sha256 || identity.sha256.length !== 64) {
    throw new Error('BLIND_PROTOCOL_V6_SHA_REQUIRED');
  }
  if (identity.sha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6_SHA256) {
    throw new Error(`BLIND_PROTOCOL_V6_SHA_MISMATCH: expected ${PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6_SHA256}, got ${identity.sha256}`);
  }
  if (identity.supersedesPolicySha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V5_SHA256) {
    throw new Error(`BLIND_PROTOCOL_V6_SUPERSEDED_POLICY_SHA_MISMATCH:${identity.supersedesPolicySha256}`);
  }
}

export function assertBlindProtocolV7Identity(identity: {
  policyId: string;
  schemaVersion: number;
  sha256?: string;
  supersedesPolicySha256?: string;
  expectedSha256?: string;
}): void {
  if (identity.policyId !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V7 && identity.policyId !== 'PHASE_9G_B_BLIND_EVALUATION_PROTOCOL_V7') {
    throw new Error(`BLIND_PROTOCOL_V7_POLICY_ID_MISMATCH:${identity.policyId}`);
  }
  if (identity.schemaVersion !== 7) {
    throw new Error(`BLIND_PROTOCOL_V7_SCHEMA_VERSION_MISMATCH:${identity.schemaVersion}`);
  }
  if (!identity.sha256 || identity.sha256.length !== 64) {
    throw new Error('BLIND_PROTOCOL_V7_SHA_REQUIRED');
  }
  if (identity.expectedSha256 && identity.sha256 !== identity.expectedSha256) {
    throw new Error(`BLIND_PROTOCOL_V7_SHA_MISMATCH: expected ${identity.expectedSha256}, got ${identity.sha256}`);
  }
  if (identity.supersedesPolicySha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6_SHA256) {
    throw new Error(`BLIND_PROTOCOL_V7_SUPERSEDED_POLICY_SHA_MISMATCH:${identity.supersedesPolicySha256}`);
  }
}

export const TRUSTED_BLIND_AUTHORIZATION_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhcS3+hKdAwTo8LsbAL8jFk38V6iq
FFjQh9lHeoS3AoMJx/34jLsZO3c+ltCVxd5yDoR8Oud/Egq20VTgfVzx4w==
-----END PUBLIC KEY-----` as const;

export interface BlindExecutionAuthorizationReceipt {
  readonly authorizationId: string;
  readonly issuer: string;
  readonly approvalIdentity: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly oneShotScope: string;
  readonly permittedExecutionMode: string;
  readonly boundRunId: string;
  readonly boundCommitSha: string;
  readonly boundProtocolSha256: string;
  readonly boundScorerSha256: string;
  readonly boundRosterSha256: string;
  readonly boundManifestSha256: string;
  readonly signatureAlgorithm: string;
  readonly signature: string;
}

export function computeAuthorizationCanonicalPayload(receipt: {
  authorizationId: string;
  issuer: string;
  approvalIdentity: string;
  issuedAt: string;
  expiresAt: string;
  oneShotScope: string;
  permittedExecutionMode: string;
  boundRunId: string;
  boundCommitSha: string;
  boundProtocolSha256: string;
  boundScorerSha256: string;
  boundRosterSha256: string;
  boundManifestSha256: string;
}): string {
  return [
    `AUTH_ID:${receipt.authorizationId}`,
    `ISSUER:${receipt.issuer}`,
    `APPROVAL_IDENTITY:${receipt.approvalIdentity}`,
    `ISSUED_AT:${receipt.issuedAt}`,
    `EXPIRES_AT:${receipt.expiresAt}`,
    `SCOPE:${receipt.oneShotScope}`,
    `MODE:${receipt.permittedExecutionMode}`,
    `RUN_ID:${receipt.boundRunId}`,
    `COMMIT_SHA:${receipt.boundCommitSha}`,
    `PROTOCOL_SHA256:${receipt.boundProtocolSha256}`,
    `SCORER_SHA256:${receipt.boundScorerSha256}`,
    `ROSTER_SHA256:${receipt.boundRosterSha256}`,
    `MANIFEST_SHA256:${receipt.boundManifestSha256}`,
  ].join('\n');
}

export function assertCryptographicBlindExecutionAuthorization(
  receipt: any,
  options: {
    expectedRunId?: string;
    currentCommitSha?: string;
    trustedPublicKeyPem?: string;
    consumedAuthorizationIds?: Set<string> | readonly string[];
  } = {},
): {
  readonly authorized: boolean;
  readonly authorizationId: string;
  readonly boundRunId: string;
  readonly approvalIdentity: string;
  readonly verifiedAt: string;
} {
  if (!receipt || typeof receipt !== 'object') {
    throw new Error('AUTHORIZATION_RECEIPT_MISSING: Authorization receipt must be a non-null object');
  }

  // 1. Mandatory nonempty run ID on both sides
  const reqRunId = options.expectedRunId?.trim();
  const receiptRunId = typeof receipt.boundRunId === 'string' ? receipt.boundRunId.trim() : typeof receipt.runId === 'string' ? receipt.runId.trim() : '';
  if (!reqRunId && !receiptRunId) {
    throw new Error('AUTHORIZATION_RUN_ID_REQUIRED: Run ID must be explicitly specified in both execution request and authorization receipt');
  }
  if (!reqRunId || !receiptRunId) {
    throw new Error(`AUTHORIZATION_RUN_ID_MISSING: requestRunId="${reqRunId || ''}", receiptRunId="${receiptRunId || ''}"`);
  }
  if (reqRunId !== receiptRunId) {
    throw new Error(`AUTHORIZATION_RUN_ID_MISMATCH: requested run ID "${reqRunId}" does not match receipt bound run ID "${receiptRunId}"`);
  }

  // 2. Reject editable status string without cryptographic signature
  if (!receipt.signature || typeof receipt.signature !== 'string' || receipt.signature.trim() === '') {
    throw new Error('AUTHORIZATION_UNSIGNED: Authorization receipt is unsigned or missing cryptographic signature');
  }

  // 3. One-shot scope and mode
  if (receipt.oneShotScope !== 'PHASE_9G_B_ONE_SHOT_BLIND_EVALUATION') {
    throw new Error(`AUTHORIZATION_SCOPE_INVALID: expected "PHASE_9G_B_ONE_SHOT_BLIND_EVALUATION", got "${receipt.oneShotScope}"`);
  }
  if (receipt.permittedExecutionMode !== 'REAL_BLIND') {
    throw new Error(`AUTHORIZATION_MODE_INVALID: expected "REAL_BLIND", got "${receipt.permittedExecutionMode}"`);
  }

  // 4. Timestamp validity & expiration
  const now = Date.now();
  const exp = new Date(receipt.expiresAt).getTime();
  if (!Number.isFinite(exp) || exp < now) {
    throw new Error(`AUTHORIZATION_EXPIRED: receipt expired at ${receipt.expiresAt}`);
  }
  const issued = new Date(receipt.issuedAt).getTime();
  if (!Number.isFinite(issued) || issued > now + 60000) {
    throw new Error(`AUTHORIZATION_ISSUED_IN_FUTURE: receipt issuedAt ${receipt.issuedAt} is in the future`);
  }

  // 5. Commit, Protocol, Scorer, Roster, Manifest binding
  if (options.currentCommitSha && receipt.boundCommitSha !== options.currentCommitSha) {
    throw new Error(`AUTHORIZATION_COMMIT_MISMATCH: receipt bound to commit ${receipt.boundCommitSha}, but current HEAD is ${options.currentCommitSha}`);
  }
  if (receipt.boundProtocolSha256 !== PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6_SHA256) {
    throw new Error(`AUTHORIZATION_PROTOCOL_MISMATCH: receipt bound to protocol ${receipt.boundProtocolSha256}, but active protocol is ${PHASE_9GB_BLIND_EVALUATION_PROTOCOL_V6_SHA256}`);
  }
  if (receipt.boundScorerSha256 && receipt.boundScorerSha256 !== '70f77a9e790edf0489d9299d413f03e5f8dffb5f388227a087099381a2b419ea') {
    throw new Error(`AUTHORIZATION_SCORER_MISMATCH: scorer SHA mismatch: ${receipt.boundScorerSha256}`);
  }
  if (receipt.boundManifestSha256 && receipt.boundManifestSha256 !== PHASE_9GB_BLIND_MANIFEST_SHA256) {
    throw new Error(`AUTHORIZATION_MANIFEST_MISMATCH: manifest SHA mismatch: ${receipt.boundManifestSha256}`);
  }

  // 6. Anti-replay consumption check
  const consumedSet = options.consumedAuthorizationIds instanceof Set
    ? options.consumedAuthorizationIds
    : new Set(options.consumedAuthorizationIds ?? []);
  if (consumedSet.has(receipt.authorizationId)) {
    throw new Error(`AUTHORIZATION_ALREADY_CONSUMED: authorization ${receipt.authorizationId} has already been consumed in a prior run`);
  }

  // 7. Cryptographic signature verification against pinned trust root
  const publicKeyPem = options.trustedPublicKeyPem ?? TRUSTED_BLIND_AUTHORIZATION_PUBLIC_KEY_PEM;
  const canonicalPayload = computeAuthorizationCanonicalPayload({
    authorizationId: receipt.authorizationId ?? '',
    issuer: receipt.issuer ?? '',
    approvalIdentity: receipt.approvalIdentity ?? '',
    issuedAt: receipt.issuedAt ?? '',
    expiresAt: receipt.expiresAt ?? '',
    oneShotScope: receipt.oneShotScope ?? '',
    permittedExecutionMode: receipt.permittedExecutionMode ?? '',
    boundRunId: receiptRunId,
    boundCommitSha: receipt.boundCommitSha ?? '',
    boundProtocolSha256: receipt.boundProtocolSha256 ?? '',
    boundScorerSha256: receipt.boundScorerSha256 ?? '',
    boundRosterSha256: receipt.boundRosterSha256 ?? '',
    boundManifestSha256: receipt.boundManifestSha256 ?? '',
  });

  const algorithm = receipt.signatureAlgorithm ?? 'SHA256';
  let sigValid = false;
  try {
    sigValid = verify(algorithm, Buffer.from(canonicalPayload, 'utf8'), publicKeyPem, Buffer.from(receipt.signature, 'base64'));
  } catch (err: any) {
    throw new Error(`AUTHORIZATION_SIGNATURE_VERIFICATION_ERROR: ${err.message}`);
  }

  if (!sigValid) {
    throw new Error('AUTHORIZATION_SIGNATURE_INVALID: Cryptographic signature verification failed against trusted public key');
  }

  return {
    authorized: true,
    authorizationId: receipt.authorizationId,
    boundRunId: receiptRunId,
    approvalIdentity: receipt.approvalIdentity,
    verifiedAt: new Date().toISOString(),
  };
}

export interface JournalEvent {
  readonly seq: number;
  readonly prevEventHash: string;
  readonly timestamp?: string;
  readonly eventType: string;
  readonly runId?: string;
  readonly payload?: Record<string, unknown>;
  readonly data?: Record<string, unknown>;
  readonly eventHash: string;
}

export const ALLOWED_JOURNAL_EVENT_TYPES = [
  'RUN_INITIALIZED',
  'STATE_TRANSITION',
  'ATTEMPT_STARTED',
  'ATTEMPT_COMMITTED',
  'ATTEMPT_FAILED',
  'ATTEMPT_OUTCOME_UNKNOWN',
  'RUN_COMPLETED',
  'RUN_BLOCKED',
  'RUN_FAILED',
] as const;

export function canonicalJournalEventUnsigned(ev: JournalEvent): {
  seq: number;
  prevEventHash: string;
  timestamp?: string;
  eventType: string;
  runId?: string;
  payload: Record<string, unknown>;
} {
  return {
    seq: ev.seq,
    prevEventHash: ev.prevEventHash,
    ...(ev.timestamp !== undefined ? { timestamp: ev.timestamp } : {}),
    eventType: ev.eventType,
    ...(ev.runId !== undefined ? { runId: ev.runId } : {}),
    payload: (ev.payload ?? ev.data ?? {}) as Record<string, unknown>,
  };
}

export function computeJournalEventHash(ev: Omit<JournalEvent, 'eventHash'>): string {
  const unsigned = canonicalJournalEventUnsigned(ev as JournalEvent);
  return createHash('sha256').update(JSON.stringify(unsigned), 'utf8').digest('hex');
}

export function assertJournalEventChainValid(
  events: readonly JournalEvent[],
  options?: { expectedRunId?: string },
): void {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('JOURNAL_EMPTY_OR_INVALID');
  }
  const genesisPrev = '0'.repeat(64);
  const activeAttempts = new Set<string>();
  const terminalAttempts = new Set<string>();
  const runId = options?.expectedRunId ?? events[0].runId;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.seq !== i) {
      throw new Error(`JOURNAL_SEQUENCE_GAP_OR_REORDER: expected ${i}, got ${ev.seq}`);
    }
    const expectedPrev = i === 0 ? genesisPrev : events[i - 1].eventHash;
    if (ev.prevEventHash !== expectedPrev) {
      throw new Error(`JOURNAL_HASH_CHAIN_BROKEN_AT_SEQ_${i}: expected ${expectedPrev}, got ${ev.prevEventHash}`);
    }
    if (!ev.eventHash || ev.eventHash.length !== 64) {
      throw new Error(`JOURNAL_INVALID_EVENT_HASH_AT_SEQ_${i}`);
    }

    // 1. Genesis check
    if (i === 0) {
      if (ev.eventType !== 'RUN_INITIALIZED') {
        throw new Error(`JOURNAL_GENESIS_EVENT_TYPE_INVALID: expected RUN_INITIALIZED, got ${ev.eventType}`);
      }
      if (ev.prevEventHash !== genesisPrev) {
        throw new Error(`JOURNAL_GENESIS_PREV_HASH_INVALID: got ${ev.prevEventHash}`);
      }
    }

    // 2. Allowed event types
    if (!ALLOWED_JOURNAL_EVENT_TYPES.includes(ev.eventType as typeof ALLOWED_JOURNAL_EVENT_TYPES[number])) {
      throw new Error(`JOURNAL_UNAUTHORIZED_EVENT_TYPE_AT_SEQ_${i}:${ev.eventType}`);
    }

    // 3. Consistent runId check
    if (runId && ev.runId && ev.runId !== runId) {
      throw new Error(`JOURNAL_RUN_ID_MISMATCH_AT_SEQ_${i}: expected ${runId}, got ${ev.runId}`);
    }

    // 4. Recompute canonical unsigned hash and verify exact cryptographic match
    const unsigned = canonicalJournalEventUnsigned(ev);
    const recomputedHash = createHash('sha256').update(JSON.stringify(unsigned), 'utf8').digest('hex');
    if (ev.eventHash !== recomputedHash) {
      throw new Error(`JOURNAL_EVENT_PAYLOAD_TAMPERED_AT_SEQ_${i}: stored ${ev.eventHash} !== recomputed ${recomputedHash}`);
    }

    // 5. Attempt ordering and terminal record uniqueness
    const payload = (ev.payload ?? ev.data ?? {}) as Record<string, unknown>;
    const candidateId = payload.candidateId as string | undefined;
    const scenarioId = payload.scenarioId as string | undefined;
    if (candidateId && scenarioId) {
      const attemptKey = `${candidateId}\0${scenarioId}`;
      if (ev.eventType === 'ATTEMPT_STARTED') {
        if (activeAttempts.has(attemptKey) || terminalAttempts.has(attemptKey)) {
          throw new Error(`JOURNAL_DUPLICATE_ATTEMPT_STARTED:${attemptKey}`);
        }
        activeAttempts.add(attemptKey);
      } else if (ev.eventType === 'ATTEMPT_COMMITTED' || ev.eventType === 'ATTEMPT_FAILED' || ev.eventType === 'ATTEMPT_OUTCOME_UNKNOWN') {
        if (!activeAttempts.has(attemptKey) && !terminalAttempts.has(attemptKey)) {
          throw new Error(`JOURNAL_ATTEMPT_TERMINATED_WITHOUT_START:${attemptKey}`);
        }
        if (terminalAttempts.has(attemptKey)) {
          throw new Error(`JOURNAL_DUPLICATE_TERMINAL_ATTEMPT_RECORD:${attemptKey}`);
        }
        activeAttempts.delete(attemptKey);
        terminalAttempts.add(attemptKey);
      }
    }
  }
}

export function assertJournalMatchesRunReceipt(
  events: readonly JournalEvent[],
  receipt: { eventCount: number; chainTipHash: string; runId?: string },
): void {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error('JOURNAL_EMPTY_CANNOT_MATCH_RECEIPT');
  }
  if (events.length !== receipt.eventCount) {
    throw new Error(`JOURNAL_TRUNCATION_OR_COUNT_MISMATCH: expected ${receipt.eventCount}, got ${events.length}`);
  }
  const actualTip = events[events.length - 1].eventHash;
  if (actualTip !== receipt.chainTipHash) {
    throw new Error(`JOURNAL_CHAIN_TIP_MISMATCH: expected ${receipt.chainTipHash}, got ${actualTip}`);
  }
  if (receipt.runId && events[0].runId && events[0].runId !== receipt.runId) {
    throw new Error(`JOURNAL_RUN_ID_MISMATCH: expected ${receipt.runId}, got ${events[0].runId}`);
  }
}

export function assertJournalChainTipAndCompleteness(
  events: readonly JournalEvent[],
  trustedAnchor?: { chainTipHash?: string; eventCount?: number },
): void {
  if (!trustedAnchor || !trustedAnchor.chainTipHash) {
    throw new Error('JOURNAL_COMPLETENESS_NOT_VERIFIABLE: Missing trusted journal chain-tip anchor or run receipt');
  }
  assertJournalEventChainValid(events);
  const actualTip = events[events.length - 1].eventHash;
  if (actualTip !== trustedAnchor.chainTipHash) {
    throw new Error(`JOURNAL_CHAIN_TIP_MISMATCH: expected ${trustedAnchor.chainTipHash}, got ${actualTip}`);
  }
  if (trustedAnchor.eventCount !== undefined && events.length !== trustedAnchor.eventCount) {
    throw new Error(`JOURNAL_TRUNCATION_OR_COUNT_MISMATCH: expected ${trustedAnchor.eventCount}, got ${events.length}`);
  }
}

export interface ProductionAudioManifestRecord {
  readonly scenarioId: string;
  readonly split: 'BLIND' | 'EVALUATION';
  readonly performerId?: string;
  readonly audio?: {
    readonly nativeSampleRateHz: number;
    readonly channelPolicy: string;
    readonly clipStartMs?: number;
    readonly clipEndMs?: number;
    readonly performanceOriginSourceMs?: number;
    readonly sourceDurationMs?: number;
    readonly sourceSampleCount?: number;
  };
  readonly source: {
    readonly sourceAudioPath: string;
    readonly sourceAudioSha256: string;
    readonly sourcePcmSha256: string;
    readonly isSyntheticFixture?: boolean;
  };
}

export function assertProductionAudioManifestValid(scenario: ProductionAudioManifestRecord): void {
  if (!scenario.scenarioId || typeof scenario.scenarioId !== 'string') {
    throw new Error('PRODUCTION_AUDIO_MANIFEST_SCENARIO_ID_REQUIRED');
  }
  if (scenario.split !== 'BLIND' && scenario.split !== 'EVALUATION') {
    throw new Error(`PRODUCTION_AUDIO_MANIFEST_INVALID_SPLIT:${scenario.split}`);
  }
  if (scenario.source?.isSyntheticFixture || scenario.scenarioId.includes('synthetic')) {
    throw new Error('SYNTHETIC_FIXTURE_REJECTED_IN_PRODUCTION');
  }
  if (!scenario.source?.sourceAudioPath || typeof scenario.source.sourceAudioPath !== 'string') {
    throw new Error('PRODUCTION_AUDIO_MANIFEST_SOURCE_PATH_REQUIRED');
  }
  if (!scenario.source?.sourceAudioSha256 || scenario.source.sourceAudioSha256.length !== 64) {
    throw new Error('PRODUCTION_AUDIO_MANIFEST_AUDIO_SHA_REQUIRED');
  }
  if (!scenario.source?.sourcePcmSha256 || scenario.source.sourcePcmSha256.length !== 64) {
    throw new Error('PRODUCTION_AUDIO_MANIFEST_PCM_SHA_REQUIRED');
  }
  if (scenario.source.sourceAudioSha256 === scenario.source.sourcePcmSha256) {
    throw new Error('PRODUCTION_AUDIO_MANIFEST_AUDIO_AND_PCM_HASH_COLLISION');
  }
  const fakeAudioSha = createHash('sha256').update(`audio_${scenario.scenarioId}`, 'utf8').digest('hex');
  const fakePcmSha = createHash('sha256').update(`pcm_${scenario.scenarioId}`, 'utf8').digest('hex');
  if (scenario.source.sourceAudioSha256 === fakeAudioSha || scenario.source.sourcePcmSha256 === fakePcmSha) {
    throw new Error('PRODUCTION_AUDIO_MANIFEST_FABRICATED_HASH_DETECTED');
  }
}

export function assertSyntheticRehearsalManifestValid(scenario: {
  scenarioId: string;
  isSynthetic?: boolean;
  split?: string;
  source?: {
    sourceAudioPath?: string;
    sourceAudioSha256?: string;
    sourcePcmSha256?: string;
  };
}): void {
  const isSynthetic = scenario.isSynthetic === true || scenario.scenarioId.includes('synthetic') || scenario.split === 'SYNTHETIC_REHEARSAL';
  if (!isSynthetic) {
    throw new Error('SYNTHETIC_REHEARSAL_MANIFEST_MUST_BE_EXPLICITLY_SYNTHETIC');
  }
  if (!scenario.source?.sourceAudioSha256 || scenario.source.sourceAudioSha256.length !== 64) {
    throw new Error('SYNTHETIC_REHEARSAL_AUDIO_SHA_REQUIRED');
  }
  if (!scenario.source?.sourcePcmSha256 || scenario.source.sourcePcmSha256.length !== 64) {
    throw new Error('SYNTHETIC_REHEARSAL_PCM_SHA_REQUIRED');
  }
}
