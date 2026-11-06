import {
  ACOUSTIC_RUNTIME_CONTRACT,
  ACOUSTIC_ANALYSIS_IDENTITY,
} from './generated/runtime-contract';
import { fail } from './errors';

/** Canonical declaration encoding: sorted object keys and unchanged array order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    )
    .join(',')}}`;
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer),
    ),
  ]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
/** Checks runtime data and its composite binding; evidence is verified by repository tooling. */
export async function assertAcousticRuntimeIdentity(): Promise<void> {
  const runtimeContractSha256 = await sha256(
    new TextEncoder().encode(canonicalJson(ACOUSTIC_RUNTIME_CONTRACT)),
  );
  const { evidenceAttestationSha256 } = ACOUSTIC_ANALYSIS_IDENTITY;
  const composite = await sha256(
    new TextEncoder().encode(
      canonicalJson({ runtimeContractSha256, evidenceAttestationSha256 }),
    ),
  );
  if (
    runtimeContractSha256 !==
      ACOUSTIC_ANALYSIS_IDENTITY.runtimeContractSha256 ||
    composite !== ACOUSTIC_ANALYSIS_IDENTITY.analysisIdentitySha256
  )
    fail('ACOUSTIC_IDENTITY_DRIFT');
}
