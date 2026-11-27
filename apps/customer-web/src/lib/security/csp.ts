import { browserPolicy, type BrowserPolicy } from './route-policy';

export function createNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export function objectStorageOrigins(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  return [
    ...new Set(
      value.split(',').map((entry) => {
        const text = entry.trim();
        let url: URL;
        try {
          url = new URL(text);
        } catch {
          throw new Error('CSP_OBJECT_STORAGE_ORIGINS requires explicit HTTP(S) origins.');
        }
        if (
          !['https:', 'http:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash ||
          /[\s*?#;'"%\\]/.test(text) ||
          url.origin === 'null' ||
          (text !== url.origin && text !== url.origin + '/')
        ) {
          throw new Error(
            'CSP_OBJECT_STORAGE_ORIGINS requires normalized origins without paths or wildcards.',
          );
        }
        return url.origin;
      }),
    ),
  ];
}

export function customerSecurity(options: {
  pathname: string;
  nonce: string;
  origins: readonly string[];
  development?: boolean;
}): { policy: BrowserPolicy; headers: Record<string, string> } {
  const { pathname, nonce, origins, development = false } = options;
  const policy = browserPolicy(pathname);
  const wasm = ['score', 'review', 'score-video', 'practice'].includes(policy);
  const transfers = [
    'upload',
    'score',
    'review',
    'media',
    'score-video',
    'preview',
    'practice',
  ].includes(policy);
  const media = ['library', 'score', 'media', 'score-video', 'preview', 'practice'].includes(
    policy,
  );
  const blobs = transfers || policy === 'library';
  const practice = policy === 'practice';
  const external = origins.length ? ' ' + origins.join(' ') : '';
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}'${wasm ? " 'wasm-unsafe-eval'" : ''}${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${blobs ? ' blob:' : ''}${external}`,
    "font-src 'self'",
    `connect-src 'self'${transfers ? ' blob:' + external : ''}`,
    `media-src 'self'${media ? ' blob:' + external : ''}`,
    `worker-src ${practice ? "'self' blob:" : "'none'"}`,
  ];
  return {
    policy,
    headers: {
      'Content-Security-Policy': directives.join('; '),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': policy === 'auth' ? 'no-referrer' : 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Permissions-Policy': `camera=${practice ? '(self)' : '()'}, microphone=${practice ? '(self)' : '()'}, geolocation=(), midi=${practice ? '(self)' : '()'}, payment=(), usb=()`,
    },
  };
}

/** Standalone Workers enforce their script response CSP rather than the parent document CSP. */
export function resourceCsp(origins: readonly string[]): string {
  return [
    "default-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "connect-src 'self' blob:" + (origins.length ? ' ' + origins.join(' ') : ''),
  ].join('; ');
}
