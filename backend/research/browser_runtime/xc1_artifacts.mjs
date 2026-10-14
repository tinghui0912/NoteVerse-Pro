import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';

export const PHASE = 'PHASE_9G_XC1_R3D_F5_RECOVERY_AND_FULL_SEALED_BAKEOFF';
export const DEPLOYMENTS = Object.freeze(['robust-browser-v1', 'online-amt-k8-browser-v1', 'basic-pitch-browser-v1']);
export function canonicalJson(value) {
  return JSON.stringify(value, function (_key, item) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
    }
    return item;
  });
}
export function digest(value) { return createHash('sha256').update(canonicalJson(value)).digest('hex'); }
export function artifactDigest(artifact) {
  const { artifactCanonicalSha256: _digest, ...content } = artifact;
  return digest(content);
}
export function validateArtifactDigest(artifact) {
  if (artifact.artifactCanonicalSha256 !== artifactDigest(artifact)) throw new Error('XC1_ARTIFACT_CANONICAL_DIGEST_MISMATCH');
}
export async function fileSha(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
export async function preflightOutput(file) {
  await mkdir(path.dirname(file), { recursive: true });
  const probe = path.join(path.dirname(file), `.xc1-write-probe-${randomUUID()}`);
  let handle;
  try {
    handle = await open(probe, 'wx');
    await handle.writeFile('XC1_OUTPUT_PREFLIGHT');
    await handle.sync();
    await handle.close(); handle = null;
  } finally {
    if (handle) await handle.close();
    await unlink(probe).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function preflightRunRoot(root) {
  for (const directory of ['failures', 'summary', 'seals', ...DEPLOYMENTS.map(id => `predictions/${id}`)]) {
    await preflightOutput(path.join(root, directory, 'preflight.json'));
  }
}
export async function atomicJson(file, value, { immutable = true } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  if (immutable && await stat(file).then(() => true, error => {
    if (error.code === 'ENOENT') return false; throw error;
  })) throw new Error(`XC1_IMMUTABLE_ARTIFACT_EXISTS:${file}`);
  const temp = path.join(path.dirname(file), `.xc1-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync(); await handle.close(); handle = null;
    await rename(temp, file);
  } finally {
    if (handle) await handle.close();
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
export async function writeArtifact(file, content) {
  const artifact = { ...content, artifactCanonicalSha256: artifactDigest(content) };
  await atomicJson(file, artifact);
  return artifact;
}
