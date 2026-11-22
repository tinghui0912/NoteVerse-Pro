// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import LibraryRoute from '@/app/[locale]/(app)/library/page';
import type { LibrarySearchParams } from '@/features/library/route-state';

vi.mock('@/features/library/library-page', () => ({
  default: ({ params }: { params: LibrarySearchParams }) => <output>{JSON.stringify(params)}</output>,
}));

it('resolves Next searchParams and composes the Library feature', async () => {
  const params = { view: 'favorites', folder: 'folder', search: 'bach', sort: 'name_asc', page: '2' };
  render(await LibraryRoute({ searchParams: Promise.resolve(params) }));
  expect(screen.getByText(JSON.stringify(params))).toBeInTheDocument();
});
