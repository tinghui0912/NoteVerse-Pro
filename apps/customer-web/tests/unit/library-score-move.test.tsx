// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { LibraryMoveScoresDialog } from '@/features/library/components/library-move-scores-dialog';
import messages from '../../messages/en/library.json';

it('offers root and flat folders when moving scores', async () => {
  const change = vi.fn();
  render(
    <LibraryMoveScoresDialog
      open
      count={1}
      pending={false}
      folderId="__root__"
      rootFolderValue="__root__"
      folders={['Alpha', 'Beta'].map((name, i) => ({
        folder_id: name,
        name,
        position: i,
        score_count: i + 2,
        created_at: '',
        updated_at: '',
      }))}
      onOpenChange={vi.fn()}
      onFolderChange={change}
      onConfirm={vi.fn()}
      t={(key) => messages[key as keyof typeof messages] ?? key}
    />,
  );
  expect(screen.getAllByRole('radio')).toHaveLength(3);
  expect(screen.getByRole('radio', { name: 'Library root' })).toBeChecked();
  expect(screen.getByText('2')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('radio', { name: 'Alpha2' }));
  expect(change).toHaveBeenCalledWith('Alpha');
});
