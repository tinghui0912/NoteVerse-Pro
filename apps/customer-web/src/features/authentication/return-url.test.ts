import { afterEach, expect, it, vi } from 'vitest';
import { getSafeReturnUrl } from './return-url';
import { navigateToLogin } from './session/document-navigation';

afterEach(() => vi.unstubAllGlobals());
it.each(['/library', '/library?view=all', '/en/library?view=all', '/invite/token?accept=1', '/score/id#versions'])('accepts local path intent %s', value => {
  expect(getSafeReturnUrl(value)).toBe(value);
});
it.each(['https://evil.example', 'http://evil.example', '//evil.example', '///evil.example', '/' + String.fromCharCode(92) + 'evil.example', '/' + String.fromCharCode(92).repeat(2) + 'evil.example', 'javascript:alert(1)', 'data:text/html,evil', '', null, undefined])('rejects external or malformed intent %s', value => {
  expect(getSafeReturnUrl(value)).toBe('/library');
});
it('performs logout document navigation through the same safe local return policy', () => {
  const assign = vi.fn();
  vi.stubGlobal('window', {location: {pathname: '/en/library', search: '?view=all', assign}});
  navigateToLogin();
  expect(assign).toHaveBeenCalledWith('/en/auth/login?returnUrl=%2Fen%2Flibrary%3Fview%3Dall');
});
