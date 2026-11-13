// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { LibraryScoreCard } from '@/components/library/library-score-card';
import { MyScoreCard } from '@/components/my-scores/my-score-card';
import messages from '../../messages/en/library.json';
import myMessages from '../../messages/en/myScores.json';
import type { LibraryScoreRead } from '@/generated/api';
const score: LibraryScoreRead = {
  score_id: 'score',
  title: 'Accessible score',
  access_origin: 'MEMBERSHIP',
  genres: [],
  folder_id: null,
  is_favorite: false,
  metadata: null,
  created_at: '2026-11-13T00:00:00',
  updated_at: '2026-11-13T00:00:00',
  derived_assets: {
    preview: { status: 'pending', asset_id: null },
    audio: { status: 'pending', asset_id: null },
  },
};
it.each([false, true])(
  'offers reversible favorite and folder organization (favorite=%s)',
  async (favorite) => {
    const toggle = vi.fn();
    render(
      <LibraryScoreCard
        score={{ ...score, is_favorite: favorite }}
        batchMode={false}
        selected={false}
        favoritePending={false}
        movePending={false}
        onOpen={vi.fn()}
        onToggleSelection={vi.fn()}
        onToggleFavorite={toggle}
        onOpenMoveDialog={vi.fn()}
        t={(key) => messages[key as keyof typeof messages] ?? key}
      />,
    );
    screen.getByRole('button', { name: 'More actions' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual([favorite ? 'Unfavorite' : 'Favorite', 'Move to']);
    await userEvent.click(
      screen.getByRole('menuitem', {
        name: favorite ? 'Unfavorite' : 'Favorite',
      }),
    );
    expect(toggle).toHaveBeenCalledOnce();
  },
);
it('keeps the My Scores owner deletion action', async () => {
  const remove = vi.fn();
  render(
    <MyScoreCard
      score={{
        score_id: 'owned',
        title: 'Owned',
        genres: [],
        version: 1,
        head_revision_id: null,
        metadata: null,
        input_assets: [],
        derived_assets: score.derived_assets,
        created_at: score.created_at,
        updated_at: score.updated_at,
        capabilities: {
          can_view: true,
          can_edit: true,
          can_delete: true,
          can_manage_members: true,
          can_manage_guest_previews: true,
          can_download: true,
          can_practice: true,
        },
      }}
      batchMode={false}
      selected={false}
      onOpen={vi.fn()}
      onToggleSelection={vi.fn()}
      onDelete={remove}
      t={(key) => {
        const value = myMessages[key as keyof typeof myMessages];
        return typeof value === 'string' ? value : key;
      }}
    />,
  );
  screen.getByRole('button', { name: 'More actions' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(
    screen.getAllByRole('menuitem').map((item) => item.textContent),
  ).toEqual([myMessages.delete]);
  await userEvent.click(
    screen.getByRole('menuitem', { name: myMessages.delete }),
  );
  expect(remove).toHaveBeenCalledOnce();
});
