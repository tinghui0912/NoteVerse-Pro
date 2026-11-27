// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SecurityDocumentBoundary } from './document-boundary';
const route = vi.hoisted(() => ({ pathname: '/zh/auth/login' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  route.pathname = '/zh/auth/login';
});

it('keeps children on the document policy and prevents cross-policy mounting', () => {
  const replace = vi.fn();
  vi.stubGlobal('window', {
    ...window,
    location: { href: 'https://app.test/zh/settings/profile?tab=a#details', replace },
  });
  const view = render(
    <SecurityDocumentBoundary policy="auth">
      <p>Form</p>
    </SecurityDocumentBoundary>,
  );
  expect(screen.getByText('Form')).toBeDefined();
  expect(replace).not.toHaveBeenCalled();
  route.pathname = '/zh/settings/profile';
  view.rerender(
    <SecurityDocumentBoundary policy="auth">
      <p>Next screen</p>
    </SecurityDocumentBoundary>,
  );
  expect(screen.queryByText('Next screen')).toBeNull();
  expect(replace).toHaveBeenCalledExactlyOnceWith(
    'https://app.test/zh/settings/profile?tab=a#details',
  );
});

it('retains same-policy navigation without a network document replacement', () => {
  route.pathname = '/en/score/a';
  const replace = vi.fn();
  vi.stubGlobal('window', {
    ...window,
    location: { href: 'https://app.test/en/score/b/edit', replace },
  });
  const view = render(
    <SecurityDocumentBoundary policy="score">
      <p>Score</p>
    </SecurityDocumentBoundary>,
  );
  route.pathname = '/en/score/b/edit';
  view.rerender(
    <SecurityDocumentBoundary policy="score">
      <p>Editor</p>
    </SecurityDocumentBoundary>,
  );
  expect(screen.getByText('Editor')).toBeDefined();
  expect(replace).not.toHaveBeenCalled();
});
