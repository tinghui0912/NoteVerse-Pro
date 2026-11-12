// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '../../../../../messages/en/library.json';
import LibraryPage from './page';
import type { LibraryFolderRead } from '@/generated/api';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
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
  useTranslations: () =>
    Object.assign(
      (key: string) => messages[key as keyof typeof messages] ?? key,
      { has: () => false },
    ),
}));
vi.mock('@/hooks/queries/use-library-queries', () => ({
  useLibraryFolders: () => ({
    data: { data: { folders, all_count: 10 } },
    isLoading: false,
    isError: false,
  }),
  useLibraryEntries: () => ({
    data: { data: [] },
    isLoading: false,
    isError: false,
  }),
  useCreateLibraryFolder: () => ({ mutate: mocks.create }),
  useUpdateLibraryFolder: () => ({ mutate: mocks.update }),
  useDeleteLibraryFolder: () => ({ mutate: mocks.remove }),
  useMoveLibraryEntries: () => ({}),
  useSetLibraryEntriesPracticeState: () => ({}),
  useTrashLibraryEntries: () => ({}),
}));

async function openPage() {
  const params = Promise.resolve({ folder: 'a' });
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
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('creates a named folder independently of the selected entry folder', async () => {
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

  it('defaults folder deletion to moving scores to Library root', async () => {
    await openPage();
    await openFolderMenu('Alpha');
    await userEvent.click(
      screen.getByRole('menuitem', { name: 'Delete folder' }),
    );
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('combobox')).toHaveTextContent(
      'Move to library root',
    );
    within(dialog).getByRole('combobox').focus();
    await userEvent.keyboard('{Enter}');
    expect(
      screen.getAllByRole('option').map((option) => option.textContent),
    ).toEqual(['Move to library root', 'Move to trash']);
    await userEvent.keyboard('{Enter}');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete folder' }),
    );
    expect(mocks.remove).toHaveBeenCalledWith(
      { folderId: 'a', mode: 'MOVE_CONTENTS_TO_ROOT' },
      expect.any(Object),
    );
  });
});
