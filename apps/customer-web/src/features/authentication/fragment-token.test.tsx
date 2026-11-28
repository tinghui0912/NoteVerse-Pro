// @vitest-environment jsdom
import { StrictMode, type PropsWithChildren } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { readFragmentToken, useFragmentToken } from './fragment-token';

afterEach(() => { vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

it.each(['verify-email', 'reset-password', 'confirm-email-change'])(
  'captures and immediately scrubs %s once under StrictMode', async page => {
    window.history.replaceState({route: page}, '', `/auth/${page}?locale=en#token=secret%2Bvalue&other=value`);
    const replace = vi.spyOn(window.history, 'replaceState');
    const local = vi.spyOn(Storage.prototype, 'setItem');
    const wrapper = ({children}: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const view = renderHook(useFragmentToken, {wrapper});
    expect(window.location.hash).toBe('');
    expect(replace).toHaveBeenCalledExactlyOnceWith({route: page}, '', `/auth/${page}?locale=en`);
    await waitFor(() => expect(view.result.current).toBe('secret+value'));
    view.rerender();
    expect(view.result.current).toBe('secret+value');
    expect(local).not.toHaveBeenCalled();
    view.unmount();
    const next = renderHook(useFragmentToken, {wrapper});
    await waitFor(() => expect(next.result.current).toBe(''));
  },
);

it.each(['/auth/verify-email', '/auth/reset-password?token=query-only', '/auth/confirm-email-change#other=value'])(
  'requires a token fragment for %s', async url => {
    window.history.replaceState(null, '', url);
    const view = renderHook(useFragmentToken);
    await waitFor(() => expect(view.result.current).toBe(''));
  },
);

it('uses URLSearchParams fragment decoding', () => {
  expect(readFragmentToken('#token=abc%2Bdef%2Fghi%3D')).toBe('abc+def/ghi=');
  expect(readFragmentToken('#token=')).toBe('');
});
