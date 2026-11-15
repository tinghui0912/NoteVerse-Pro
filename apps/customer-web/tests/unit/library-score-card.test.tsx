// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { LibraryScoreCard } from '@/components/library/library-score-card';
import messages from '../../messages/en/library.json';
import type { LibraryScoreRead } from '@/generated/api';
const score: LibraryScoreRead = {
  score_id: 'score',
  display_title: 'Accessible score',
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
