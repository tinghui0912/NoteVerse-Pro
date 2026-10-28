import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import core from './acoustic-core-identity.json';
import adapters from '../source/source-adapter-identities.json';
import { ACOUSTIC_MODEL, assertAcousticIdentity, canonicalJson } from './model-contract';

type FileAttestation = Readonly<{ path: string; bytes: number; sha256: string }>;
const repositoryRoot = path.resolve('../..');
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function fileAttestations(value: unknown, key: string): { key: string; entry: FileAttestation }[] {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const own = typeof record.path === 'string' && typeof record.bytes === 'number' && typeof record.sha256 === 'string'
    ? [{ key, entry: record as FileAttestation }] : [];
  return [...own, ...Object.entries(record).flatMap(([name, child]) => fileAttestations(child, `${key}.${name}`))];
}

// Repository text identity is UTF-8 with CRLF -> LF only (no trim or other rewriting).
// Binary assets, including .f32 coefficients, are attested as exact raw bytes.
function contentBytes(file: string, raw: Buffer): Buffer {
  return /\.(?:ts|tsx|js|mjs|cjs|json)$/.test(file)
    ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : raw;
}
function assertFileAttestation(entry: FileAttestation, raw = readFileSync(path.join(repositoryRoot, entry.path))): void {
  const bytes = contentBytes(entry.path, raw);
  if (bytes.length !== entry.bytes || digest(bytes) !== entry.sha256) {
    throw new Error(`Repository file attestation mismatch: ${entry.path}`);
  }
}

const attestations = [...fileAttestations(core, 'core'), ...fileAttestations(adapters, 'adapters')];
it('discovers every declared current-file attestation, including the source executor and publication', () => {
  expect(attestations.map(({ key }) => key)).toEqual(expect.arrayContaining([
    'core.acousticPublication.executorSource', 'core.acousticPublication.publicationSource',
    'core.decoder.authoritativeSource', 'core.ownership.plannerSource', 'core.resampler.source',
    'core.resampler.coefficients', 'core.resampler.coefficients48000',
  ]));
});
it.each(attestations)('$key attests the current repository content', ({ entry }) => {
  assertFileAttestation(entry);
});
it.each(['bytes', 'sha256'] as const)('rejects an altered declared %s without changing the real identity', field => {
  const declared = core.acousticPublication.executorSource;
  const altered = { ...declared, [field]: field === 'bytes' ? declared.bytes + 1 : '0'.repeat(64) };
  expect(() => assertFileAttestation(altered)).toThrow('Repository file attestation mismatch');
});
it('normalizes only text CRLF, preserving BOM, spaces and a standalone CR', () => {
  const lf = Buffer.from('\ufeffsource  \nend\r', 'utf8');
  const crlf = Buffer.from('\ufeffsource  \r\nend\r', 'utf8');
  expect(contentBytes('source.ts', crlf)).toEqual(lf);
  assertFileAttestation({ path: 'source.ts', bytes: lf.length, sha256: digest(lf) }, crlf);
});
it('never normalizes coefficient bytes even when they contain CRLF byte values', () => {
  const raw = Buffer.from([13, 10, 0, 255]);
  expect(contentBytes('coefficients.f32', raw)).toEqual(raw);
  assertFileAttestation({ path: 'coefficients.f32', bytes: raw.length, sha256: digest(raw) }, raw);
});
it('binds the repaired declaration and both composite identities through the existing canonical JSON contract', async () => {
  // Canonical JSON hashing attests the declaration, not the files named inside it.
  // The repository checks above close that separate attestation gap; browser code needs no fs.
  await assertAcousticIdentity();
  expect(digest(canonicalJson(core))).toBe(ACOUSTIC_MODEL.identitySha256);
  for (const adapter of Object.values(adapters)) {
    expect(adapter.identity.acousticCoreIdentitySha256).toBe(ACOUSTIC_MODEL.identitySha256);
    expect(digest(canonicalJson(adapter.identity))).toBe(adapter.identitySha256);
  }
});
