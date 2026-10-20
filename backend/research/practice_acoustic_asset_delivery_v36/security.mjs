import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export function sanitizeUrl(input) {
  const url = new URL(input);
  return { scheme: url.protocol.slice(0, -1), hostname: url.hostname, pathname: url.pathname,
    queryParameterNames: [...new Set(url.searchParams.keys())].sort(),
    fingerprint: createHash('sha256').update(input).digest('hex') };
}

export function scanText(text, opaqueSecrets = []) {
  const findings = [];
  const patterns = [
    ['SIGNED_URL_WITH_QUERY_VALUES', /https?:\/\/[^\s"'<>]+\?[^\s"'<>]*(?:x-oss-signature|X-Amz-Signature|x-oss-credential)=[^\s"'&<>]+/gi],
    ['SIGNATURE_VALUE', /(?:x-oss-signature|X-Amz-Signature)["']?\s*[:=]\s*["']?[a-z0-9%/+]{16,}/gi],
    ['BEARER_VALUE', /Bearer\s+[a-z0-9._~+/-]{16,}/gi],
    ['JWT_VALUE', /eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/gi],
    ['SECRET_LITERAL_ASSIGNMENT', /["'](?:password|secret_key|access_key_id|access_key_secret|secret_access_key|authorization|cookie|set-cookie)["']\s*:\s*["'][^"'\r\n]{8,}["']/gi],
    ['EMAIL_VALUE', /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi],
    ['OSS_KEY_ID_VALUE', /\bLTAI[a-z0-9]{12,}\b/gi]
  ];
  for (const [kind, regex] of patterns) for (const m of text.matchAll(regex)) findings.push({ kind, offset: m.index });
  for (const value of opaqueSecrets) if (value.length >= 8 && text.includes(value)) findings.push({ kind: 'EXACT_LOCAL_SECRET_MATCH', offset: text.indexOf(value) });
  return findings;
}

export async function scanNewFiles(root, relativeDirs) {
  const opaqueSecrets = [];
  const collect = env => {
    for (const [name, value] of Object.entries(env)) if (/(?:PASSWORD|EMAIL|SECRET|TOKEN|ACCESS_KEY_ID|ACCESS_KEY_SECRET)/i.test(name)
      && typeof value === 'string' && value.length >= 8) opaqueSecrets.push(value);
  };
  collect(process.env);
  const files = [], findings = [];
  const visit = async relative => {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const p = relative + '/' + entry.name;
      if (entry.isDirectory()) await visit(p);
      else if (entry.isFile()) {
        const data = await readFile(path.join(root, p)); files.push({ path: p, bytes: data.length });
        for (const finding of scanText(data.toString('utf8'), opaqueSecrets)) findings.push({ path: p, ...finding });
      } else throw Error('UNEXPECTED_NONREGULAR_V36_FILE');
    }
  };
  for (const dir of relativeDirs) await visit(dir);
  return { result: findings.length ? 'BLOCKED_SECRET_SCAN' : 'PASS', files, findings,
    secretValuesEmitted: false, scope: 'ALL_NEW_V36_SOURCE_AND_REPORT_BYTES', credentialFilesRead: false };
}

export function securitySelfTests() {
  const secret = 'a'.repeat(64), names = ['x-oss-signature-version', 'x-oss-date', 'x-oss-expires', 'x-oss-credential', 'x-oss-signature'];
  const value = 'https:' + '//bucket.example.invalid/model.onnx?' + names.map(n => n + '=' + secret).join('&');
  const safe = sanitizeUrl(value);
  assert.deepEqual(safe.queryParameterNames, [...names].sort());
  assert.ok(!JSON.stringify(safe).includes(secret));
  assert.ok(scanText(value).length);
  assert.ok(scanText('Bearer ' + secret).length);
  assert.ok(scanText('eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12)).length);
  assert.ok(scanText(JSON.stringify({ password: secret })).length);
  assert.ok(scanText('opaque ' + secret, [secret]).length);
  assert.equal(scanText(JSON.stringify(safe)).length, 0);
  return { result: 'PASS', syntheticCases: 7, purpose: 'Security of additive blocked-phase closeout only; not delivery qualification' };
}
