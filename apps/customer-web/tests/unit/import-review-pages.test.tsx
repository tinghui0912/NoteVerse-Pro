// @vitest-environment jsdom
import React, { Suspense } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ReviewPage from '@/app/[locale]/(app)/imports/[jobId]/review/page';
import ReviewEditorPage from '@/app/[locale]/(workspace)/imports/[jobId]/review/edit/page';

const state = vi.hoisted(() => ({
  push: vi.fn(), back: vi.fn(), document: vi.fn(),
  error: null as string | null,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, back: state.back }),
  useParams: () => ({ jobId: 'job' }),
  notFound: vi.fn(),
}));
vi.mock('@/i18n/routing', () => ({ Link: ({ children, href }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href}>{children}</a> }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/features/imports/review/use-review-page-data', () => ({
  useReviewPageData: () => ({ loading: false, error: state.error, confirming: false, validationWarnings: [], original: { urls: [] }, recognizedXml: null, confirmRecognition: vi.fn() }),
}));
vi.mock('@/features/imports/review/review-score-comparison', () => ({ ReviewScoreComparison: () => null }));
vi.mock('@/features/imports/review/review-validation-warnings', () => ({ ReviewValidationWarnings: () => null }));
vi.mock('@/features/imports/review/use-review-editor-document', () => ({ useReviewEditorDocument: (input: { jobId: string }) => state.document(input) }));
vi.mock('@/components/editor/editor-workspace-page', () => ({ EditorWorkspacePage: () => <div>temporary review editor</div> }));
vi.mock('@/contexts/editor-provider', () => ({ EditorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

beforeEach(() => { vi.clearAllMocks(); state.error = null; });

it('opens the canonical temporary editor from Import Review', async () => {
  const params = Promise.resolve({ jobId: 'job' });
  await act(async () => { render(<Suspense><ReviewPage params={params} /></Suspense>); });
  fireEvent.click(await screen.findByRole('button', { name: 'needsEdit' }));
  expect(state.push).toHaveBeenCalledWith('/imports/job/review/edit');
});

it('composes the temporary editor from the exact Import job identity', () => {
  render(<ReviewEditorPage />);
  expect(screen.getByText('temporary review editor')).toBeInTheDocument();
  expect(state.document).toHaveBeenCalledWith({ jobId: 'job' });
});

it('shows unavailable review reads without editing or confirmation commands', async () => {
  state.error = 'Review unavailable';
  const params = Promise.resolve({ jobId: 'job' });
  await act(async () => { render(<Suspense><ReviewPage params={params} /></Suspense>); });
  expect(await screen.findByText('Review unavailable')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'needsEdit' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'looksGood' })).not.toBeInTheDocument();
});
