// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import scoreMessages from '../../../../../messages/en/score.json';
import messages from '../../../../../messages/en/library.json';
import LibraryPage from './page';
import type { LibraryFolderRead, LibraryScoreRead } from '@/generated/api';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
  favorite: vi.fn(),
  move: vi.fn(),
  scores: [] as LibraryScoreRead[],
  deleteScores: vi.fn(),
}));
const folders: LibraryFolderRead[] = [
  {
    folder_id: 'b',
    name: 'Beta',
    position: 1,
    score_count: 3,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
  {
    folder_id: 'a',
    name: 'Alpha',
    position: 1,
    score_count: 7,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
];
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/i18n/routing', () => ({
  Link: ({
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) =>
    Object.assign(
      (key: string) =>
        (namespace === 'score'
          ? scoreMessages[key as keyof typeof scoreMessages]
          : messages[key as keyof typeof messages]) ?? key,
      { has: () => false },
    ),
}));
vi.mock('@/hooks/queries/use-score-queries', () => ({
  useDeleteScores: () => ({ mutate: mocks.deleteScores, reset: vi.fn() }),
}));
vi.mock('@/hooks/queries/use-library-queries', () => ({
  useLibraryFolders: () => ({
    data: { data: { folders, all_count: 10 } },
    isLoading: false,
    isError: false,
  }),
  useLibraryScores: () => ({
    data: { data: mocks.scores },
    isLoading: false,
    isError: false,
  }),
  useCreateLibraryFolder: () => ({ mutate: mocks.create }),
  useUpdateLibraryFolder: () => ({ mutate: mocks.update }),
  useDeleteLibraryFolder: () => ({ mutate: mocks.remove }),
  useMoveLibraryScores: () => ({ mutate: mocks.move }),
  useFavoriteLibraryScores: () => ({ mutate: mocks.favorite }),
}));

async function openPage(
  query: { view?: string; folder?: string } = { folder: 'a' },
) {
  const params = Promise.resolve(query);
  await act(async () => {
    render(<LibraryPage searchParams={params} />);
  });
}

async function openFolderMenu(name: string) {
  const folderRow = screen.getByRole('button', { name }).parentElement!;
  const trigger = within(folderRow).getByRole('button', {
    name: 'More actions',
  });
  trigger.focus();
  await userEvent.keyboard('{Enter}');
}

describe('Library folder organization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scores = [];
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('creates a named folder independently of the selected score folder', async () => {
    await openPage();
    await userEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Folder name'), {
      target: { value: ' Studies ' },
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Create folder' }),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      { name: 'Studies' },
      expect.any(Object),
    );
  });

  it('renders flat folder order and counts and offers Rename and Delete', async () => {
    await openPage();
    const folderButtons = screen
      .getAllByRole('button')
      .filter((button) => ['Alpha', 'Beta'].includes(button.textContent ?? ''));
    expect(folderButtons.map((button) => button.textContent)).toEqual([
      'Alpha',
      'Beta',
    ]);
    expect(
      within(folderButtons[0].parentElement!).getByText('7'),
    ).toBeInTheDocument();
    await openFolderMenu('Alpha');
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Rename', 'Delete folder']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Folder name'), {
      target: { value: 'Renamed' },
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Save folder' }),
    );
    expect(mocks.update).toHaveBeenCalledWith(
      { folderId: 'a', name: 'Renamed' },
      expect.any(Object),
    );
  });

  it('deletes a folder and returns its scores to root', async () => {
    await openPage();
    await openFolderMenu('Alpha');
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Delete folder' }),
    );
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/return to Library root/),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete folder' }),
    );
    expect(mocks.remove).toHaveBeenCalledWith('a', expect.any(Object));
  });

  it('presents access-derived views and only personal organization actions', async () => {
    await openPage();
    for (const label of [
      'All scores',
      'Created by me',
      'Shared with me',
      'Favorites',
      'Folders',
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
    for (const label of [
      'Add to Library',
      'Remove from library',
      'Recent practice',
      'To practice',
      'In progress',
      'Mastered',
      'Trash',
      'Mark as',
    ])
      expect(screen.queryByText(label)).not.toBeInTheDocument();
  });
  it('organizes selected Scores by public identity without organization rows', async () => {
    mocks.scores = ['owned-score', 'shared-score'].map((id, i) => ({
      score_id: id,
      access_origin: i ? 'MEMBERSHIP' : 'OWNER',
      title: id,
      folder_id: null,
      genres: [],
      metadata: null,
      is_favorite: false,
      derived_assets: {
        preview: { status: 'pending', asset_id: null },
        audio: { status: 'pending', asset_id: null },
      },
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    }));
    await openPage();
    await userEvent.click(
      screen.getByRole('button', { name: 'Batch operations' }),
    );
    await userEvent.click(
      screen.getAllByRole('checkbox', { name: /Select score/ })[0],
    );
    await userEvent.click(screen.getByRole('button', { name: 'Favorite' }));
    expect(mocks.favorite).toHaveBeenCalledWith(
      { score_ids: ['owned-score'], is_favorite: true },
      expect.any(Object),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unfavorite' }));
    expect(mocks.favorite).toHaveBeenCalledWith(
      { score_ids: ['owned-score'], is_favorite: false },
      expect.any(Object),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Move to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mocks.move).toHaveBeenCalledWith(
      { score_ids: ['owned-score'], target_folder_id: null },
      expect.any(Object),
    );
  });
  function seedScores(mixed = true) {
    mocks.scores = ['owner', ...(mixed ? ['member'] : [])].map((id) => ({
      score_id: id,
      access_origin: id === 'owner' ? 'OWNER' : 'MEMBERSHIP',
      title: id,
      folder_id: null,
      genres: [],
      metadata: null,
      is_favorite: false,
      derived_assets: {
        preview: { status: 'pending', asset_id: null },
        audio: { status: 'pending', asset_id: null },
      },
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    }));
  }

  it.each([
    { view: 'all' },
    { view: 'favorites' },
    { folder: 'a' },
    { view: 'shared_with_me' },
    { view: 'created_by_me', folder: 'a' },
  ])('keeps personal organization toolbar in scope %o', async (query) => {
    seedScores();
    await openPage(query);
    expect(screen.getByText('You own')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Batch operations' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Favorite' }));
    expect(mocks.favorite).toHaveBeenCalledWith(
      { score_ids: ['owner', 'member'], is_favorite: true },
      expect.any(Object),
    );
    expect(
      screen.queryByRole('button', { name: /Delete/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Leave/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Move to' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(mocks.move).toHaveBeenCalledWith(
      { score_ids: ['owner', 'member'], target_folder_id: null },
      expect.any(Object),
    );
  });

  it('deletes owned Scores from Created by me without mixing Import Jobs', async () => {
    seedScores(false);
    await openPage({ view: 'created_by_me' });
    const card = screen.getByText('owner').closest('[class*="group"]')!;
    within(card as HTMLElement)
      .getByRole('button', { name: 'More actions' })
      .focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Delete score' }),
    );
    expect(
      screen.getByText(scoreMessages.deleteScoreDescription),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete score' }));
    expect(mocks.deleteScores).toHaveBeenCalledWith(
      ['owner'],
      expect.any(Object),
    );
    await userEvent.click(
      screen.getByRole('button', { name: messages.cancel }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Batch operations' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete selected scores' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete score' }));
    expect(mocks.deleteScores).toHaveBeenLastCalledWith(
      ['owner'],
      expect.any(Object),
    );
  });

  it('opens a Score directly and makes folder navigation a complete scope', async () => {
    seedScores();
    await openPage({ view: 'shared_with_me' });
    await userEvent.click(screen.getByText('member'));
    expect(mocks.push).toHaveBeenCalledWith('/score/member');
    await userEvent.click(screen.getByRole('button', { name: 'Alpha' }));
    expect(mocks.push).toHaveBeenCalledWith('/library?folder=a');
  });
});
