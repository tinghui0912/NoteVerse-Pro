import { describe, expect, it } from 'vitest';

import { getSafeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';

describe('auth return url helpers', () => {
  it('accepts only relative same-origin return URLs', () => {
    expect(getSafeReturnUrl('/invite/token?accept=1')).toBe('/invite/token?accept=1');
    expect(getSafeReturnUrl('/score/score-1')).toBe('/score/score-1');
    expect(getSafeReturnUrl(null)).toBe('/upload');
    expect(getSafeReturnUrl('https://evil.example/invite')).toBe('/upload');
    expect(getSafeReturnUrl('//evil.example/invite')).toBe('/upload');
  });

  it('preserves safe return URLs when moving between login and register', () => {
    expect(withReturnUrl('/register', '/invite/token?accept=1')).toBe(
      '/register?returnUrl=%2Finvite%2Ftoken%3Faccept%3D1'
    );
    expect(withReturnUrl('/login', '/score/score-1')).toBe('/login?returnUrl=%2Fscore%2Fscore-1');
    expect(withReturnUrl('/register', 'https://evil.example')).toBe('/register');
  });
});
