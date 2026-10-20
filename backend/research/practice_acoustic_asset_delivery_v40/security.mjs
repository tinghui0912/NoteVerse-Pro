import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

export function sanitizeUrl(value) {
  const url = new URL(value);
  return { scheme: url.protocol.slice(0, -1), hostname: url.hostname, pathname: url.pathname,
    queryParameterNames: [...url.searchParams.keys()].sort(),
    fingerprint: createHash('sha256').update(value).digest('hex') };
}
export function scanText(text, secrets = []) {
  const patterns = [
    /https?:\/\/[^\s"'<>]+\?[^\s"'<>]*(?:x-oss-signature|x-oss-credential|X-Amz-Signature)=[^\s"'&<>]+/gi,
    /(?:x-oss-signature|x-oss-credential)["']?\s*[:=]\s*["']?[a-z0-9%/+]{16,}/gi,
    /Bearer\s+[a-z0-9._~+/-]{16,}/gi,
    /eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/gi,
    /["'](?:password|refresh_token|csrf_token|secret_key|access_key_id|access_key_secret|authorization|cookie|set-cookie)["']\s*:\s*["'][^"'\r\n]{8,}["']/gi,
    /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
    /\bLTAI[a-z0-9]{12,}\b/gi,
    /^(?:password|refresh_token|csrf_token|access_key_id|access_key_secret|secret_key|authorization|cookie|set-cookie)=[^\r\n]{8,}$/gmi,
    /\b(?:ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,})\b/gi,
    /https?:\/\/[^\s/"'<>:]+:[^\s/"'<>]+@/gi
  ];
  const findings = [];
  patterns.forEach((pattern, rule) => { for (const match of text.matchAll(pattern)) findings.push({ rule, offset: match.index }); });
  secrets.forEach(secret => { if (secret?.length >= 4 && text.includes(secret)) findings.push({ rule: 'OPAQUE_SECRET_MATCH' }); });
  return findings;
}
export function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isSymbolicLink()) throw Error('NONREGULAR_RESEARCH_FILE');
    return e.isDirectory() ? filesUnder(dir + '/' + e.name) : [dir + '/' + e.name];
  });
}
export function scanFiles(dirs, secrets = []) {
  const files = dirs.flatMap(filesUnder), findings = [];
  for (const file of files) for (const finding of scanText(readFileSync(file).toString('utf8'), secrets)) findings.push({ file, ...finding });
  if (findings.length) throw Object.assign(Error('SECRET_SCAN_BLOCKED'), { safeCode: 'SECRET_SCAN_BLOCKED', findings });
  return { result: 'PASS', filesScanned: files.length, persistedSecretValues: 0 };
}
