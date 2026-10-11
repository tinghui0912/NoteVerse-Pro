import { createHash } from 'node:crypto';
import { access, open, unlink } from 'node:fs/promises';
import path from 'node:path';

const WINDOWS_FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/;
const SCENARIO_FILE_KEY_HEX = /^[a-f0-9]{64}$/;

export function scenarioFileKey(scenarioId) {
  if (typeof scenarioId !== 'string' || scenarioId.length === 0) {
    throw new Error('SCENARIO_ID_REQUIRED_FOR_EVIDENCE_FILE_KEY');
  }
  return createHash('sha256').update(scenarioId, 'utf8').digest('hex');
}

export function evidenceFileName(candidateId, scenarioId) {
  const key = scenarioFileKey(scenarioId);
  const fileName = `${candidateId}__${key}.json`;
  assertSafeEvidenceFileName(fileName);
  return fileName;
}

export function evidenceStorageKey(candidateId, scenarioId) {
  return `${candidateId}__${scenarioFileKey(scenarioId)}`;
}

export function evidenceFilePath(evidenceDir, candidateId, scenarioId) {
  return path.resolve(evidenceDir, evidenceFileName(candidateId, scenarioId));
}

export function nonCanonicalEvidenceFileName(candidateId, scenarioId, status, timestamp) {
  const key = scenarioFileKey(scenarioId);
  const safeStatus = String(status).replace(/[^A-Z0-9_-]/gi, '_');
  const safeTimestamp = String(timestamp).replace(/[^0-9A-Za-z_-]/g, '_');
  const fileName = `${candidateId}__${key}__${safeStatus}__${safeTimestamp}.json`;
  assertSafeEvidenceFileName(fileName);
  return fileName;
}

export function assertSafeEvidenceFileName(fileName) {
  const base = path.basename(fileName);
  if (base !== fileName) {
    throw new Error(`EVIDENCE_FILENAME_MUST_NOT_CONTAIN_PATH_SEPARATOR:${fileName}`);
  }
  if (WINDOWS_FORBIDDEN_FILENAME_CHARS.test(fileName)) {
    throw new Error(`EVIDENCE_FILENAME_CONTAINS_FORBIDDEN_CHARACTER:${fileName}`);
  }
  const parts = fileName.split('__');
  const keyPart = parts[1]?.replace(/\.json$/, '');
  if (!keyPart || !SCENARIO_FILE_KEY_HEX.test(keyPart)) {
    throw new Error(`EVIDENCE_FILENAME_MISSING_SCENARIO_FILE_KEY:${fileName}`);
  }
}

export function assertEvidenceRecordPathBinding({ filePath, record, candidateId, scenarioId }) {
  const expectedKey = scenarioFileKey(scenarioId);
  const expectedName = evidenceFileName(candidateId, scenarioId);
  if (path.basename(filePath) !== expectedName) {
    throw new Error(`EVIDENCE_PATH_KEY_MISMATCH:${candidateId}:${scenarioId}`);
  }
  if (record.scenarioId !== scenarioId || record.candidateId !== candidateId) {
    throw new Error(`EVIDENCE_RECORD_ID_MISMATCH:${candidateId}:${scenarioId}`);
  }
  if (record.scenarioFileKey !== expectedKey) {
    throw new Error(`EVIDENCE_RECORD_SCENARIO_FILE_KEY_MISMATCH:${candidateId}:${scenarioId}`);
  }
}

export async function prevalidateEvidencePaths({ evidenceDir, scenarios, candidateIds }) {
  await access(evidenceDir);
  const probePath = path.resolve(evidenceDir, `.write-probe-${process.pid}-${Date.now()}.tmp`);
  const probe = await open(probePath, 'wx');
  await probe.close();
  await unlink(probePath);

  const paths = new Map();
  const collisions = [];
  for (const candidateId of candidateIds) {
    for (const scenario of scenarios) {
      if (scenario.candidateEligibility?.[candidateId] === false) continue;
      const scenarioId = scenario.scenarioId;
      const fileName = evidenceFileName(candidateId, scenarioId);
      const fullPath = path.resolve(evidenceDir, fileName);
      if (fullPath.length >= 240) {
        throw new Error(`EVIDENCE_PATH_TOO_LONG:${candidateId}:${scenarioId}:${fullPath.length}`);
      }
      const storageKey = evidenceStorageKey(candidateId, scenarioId);
      const existing = paths.get(fullPath);
      if (existing && existing.storageKey !== storageKey) {
        collisions.push({ filePath: fullPath, first: existing, second: { candidateId, scenarioId, storageKey } });
      }
      paths.set(fullPath, { candidateId, scenarioId, scenarioFileKey: scenarioFileKey(scenarioId), storageKey });
    }
  }
  if (collisions.length > 0) {
    throw new Error(`EVIDENCE_PATH_COLLISION:${JSON.stringify(collisions.slice(0, 3))}`);
  }
  return {
    eligibleEvidencePathCount: paths.size,
    paths: [...paths.entries()].map(([filePath, identity]) => ({ filePath, ...identity })),
  };
}
