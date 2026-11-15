// @vitest-environment jsdom
import React from 'react';
import {
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryClient,
  QueryClientProvider,
  type QueryObserverOptions,
} from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { ImportActivity } from '@/components/imports/import-activity';
import { useImportJobList } from '@/hooks/queries/use-import-job-queries';
import { queryKeys } from '@/lib/query-client';
import messages from '../../messages/en/imports.json';
import errorMessages from '../../messages/en/errors.json';
import type { ImportJobRead } from '@/generated/api';
const api = vi.hoisted(() => ({
  listImportJobs: vi.fn(),
  retryImportJob: vi.fn(),
  deleteImportJob: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ importJobsApi: api }));
vi.mock('@/i18n/routing', () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
const job = (state: ImportJobRead['state']): ImportJobRead => ({
  job_id: state,
  state,
  title: `${state} import`,
  progress: 37,
  created_at: '2026-11-15T10:00:00Z',
  updated_at: '2026-11-15T10:00:00Z',
  score_id: state === 'CONFIRMED' ? 'formal-score' : null,
  public_code: state === 'FAILURE' ? 'score_recognition_failed' : null,
});
const jobs = [
  'PENDING',
  'RUNNING',
  'PENDING_REVIEW',
  'FAILURE',
  'CONFIRMED',
].map((state) => job(state as ImportJobRead['state']));
function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale="en"
        messages={{ imports: messages, errors: errorMessages }}
      >
        {children}
      </NextIntlClientProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.listImportJobs.mockImplementation((page: number) =>
    Promise.resolve({ items: page === 1
          ? jobs
          : [
              {
                ...job('CONFIRMED'),
                title: 'Second page import',
                job_id: 'second',
              },
            ], ...{ page, page_size: 20, total: 21, total_pages: 2 } }),
  );
  api.retryImportJob.mockResolvedValue({ job_id: 'new-attempt' });
  api.deleteImportJob.mockResolvedValue(undefined);
});
it('presents each processing state with only its current commands', async () => {
  const { wrapper, client } = harness();
  render(<ImportActivity />, { wrapper });
  await screen.findByText('PENDING import');
  function card(state: string) {
    return screen.getByText(`${state} import`).parentElement!;
  }
  for (const [state, label] of [
    ['PENDING', 'Queued'],
    ['RUNNING', 'Processing'],
  ]) {
    const scope = within(card(state));
    expect(scope.getByText(label)).toBeInTheDocument();
    expect(scope.getByRole('progressbar')).toBeInTheDocument();
    expect(scope.queryAllByRole('button')).toHaveLength(0);
    expect(scope.queryAllByRole('link')).toHaveLength(0);
  }
  expect(
    within(card('PENDING_REVIEW')).getByRole('link', { name: 'Review' }),
  ).toHaveAttribute('href', '/review/PENDING_REVIEW');
  expect(
    within(card('FAILURE')).getByText(errorMessages.score_recognition_failed),
  ).toBeInTheDocument();
  expect(
    within(card('FAILURE')).getByRole('button', { name: 'Retry' }),
  ).toBeInTheDocument();
  expect(
    within(card('FAILURE')).getByRole('button', { name: 'Delete import' }),
  ).toBeInTheDocument();
  const confirmed = within(card('CONFIRMED'));
  expect(confirmed.getByText('Completed')).toBeInTheDocument();
  expect(confirmed.getByRole('link', { name: 'Open score' })).toHaveAttribute(
    'href',
    '/score/formal-score',
  );
  expect(confirmed.queryAllByRole('button')).toHaveLength(0);
  client.clear();
});
it('retries the failed process through the API and invalidates the list without hiding it', async () => {
  const { wrapper, client } = harness();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<ImportActivity />, { wrapper });
  const failed = await screen.findByText('FAILURE import');
  await userEvent.click(
    within(failed.parentElement!).getByRole('button', { name: 'Retry' }),
  );
  await waitFor(() =>
    expect(api.retryImportJob).toHaveBeenCalledWith(
      'FAILURE',
      expect.anything(),
    ),
  );
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: queryKeys.importJobs.all,
  });
  expect(screen.getByText('FAILURE import')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Second page import')).toBeInTheDocument();
  expect(api.listImportJobs).toHaveBeenCalledWith(
    2,
    20,
    expect.any(AbortSignal),
  );
  client.clear();
});
it('deletes only a terminal unconfirmed import after confirmation', async () => {
  const { wrapper, client } = harness();
  render(<ImportActivity />, { wrapper });
  const target = await screen.findByText('PENDING_REVIEW import');
  await userEvent.click(
    within(target.parentElement!).getByRole('button', {
      name: 'Delete import',
    }),
  );
  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete import',
    }),
  );
  await waitFor(() =>
    expect(api.deleteImportJob).toHaveBeenCalledWith(
      'PENDING_REVIEW',
      expect.anything(),
    ),
  );
  client.clear();
});
it.each([
  'PENDING',
  'RUNNING',
  'PENDING_REVIEW',
  'FAILURE',
  'CONFIRMED',
] as const)('polls only active processing collections (%s)', async (state) => {
  api.listImportJobs.mockResolvedValue({ items: [job(state)], ...{ page: 1, page_size: 20, total: 1, total_pages: 1 } });
  const { client, wrapper } = harness();
  const hook = renderHook(() => useImportJobList(1, 20), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  const query = client
    .getQueryCache()
    .find({ queryKey: queryKeys.importJobs.list(1, 20) })!;
  const interval = (query.options as QueryObserverOptions).refetchInterval;
  expect(typeof interval).toBe('function');
  if (typeof interval === 'function')
    expect(interval(query)).toBe(
      ['PENDING', 'RUNNING'].includes(state) ? 5000 : false,
    );
  hook.unmount();
  client.clear();
});


it.each([null, 'private_provider_failure'])('uses product fallback for an unmapped public code %s', async (code) => {
  api.listImportJobs.mockResolvedValue({ items: [{ ...job('FAILURE'), public_code: code }], page: 1, page_size: 20, total: 1 });
  const { wrapper } = harness();
  render(<ImportActivity />, { wrapper });
  const title = await screen.findByText('FAILURE import');
  expect(within(title.parentElement!).getByText(messages.failed)).toBeInTheDocument();
  expect(screen.queryByText('private_provider_failure')).not.toBeInTheDocument();
});
