// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PaginationControls } from '@/components/ui/pagination-controls';
import { LibraryPagination } from '@/components/library/library-pagination';
import { MyScoresPagination } from '@/components/my-scores/my-scores-pagination';

describe('PaginationControls', () => {
  const mockT = (key: string, values?: Record<string, string | number>) => {
    if (key === 'pagination') {
      return `第 ${values?.page} / ${values?.totalPages} 页`;
    }
    if (key === 'previousPage') return '上一页';
    if (key === 'nextPage') return '下一页';
    return key;
  };

  it('renders page info and navigation buttons correctly', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        page={2}
        totalPages={5}
        canGoPrevious={true}
        canGoNext={true}
        onPageChange={onPageChange}
        t={mockT}
      />
    );

    expect(screen.getByText('第 2 / 5 页')).toBeInTheDocument();
    const prevBtn = screen.getByRole('button', { name: '上一页' });
    const nextBtn = screen.getByRole('button', { name: '下一页' });

    expect(prevBtn).toBeEnabled();
    expect(nextBtn).toBeEnabled();

    fireEvent.click(prevBtn);
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('disables previous button on first page', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        page={1}
        totalPages={5}
        canGoPrevious={false}
        canGoNext={true}
        onPageChange={onPageChange}
        t={mockT}
      />
    );

    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled();
  });

  it('disables next button on last page', () => {
    const onPageChange = vi.fn();
    render(
      <PaginationControls
        page={5}
        totalPages={5}
        canGoPrevious={true}
        canGoNext={false}
        onPageChange={onPageChange}
        t={mockT}
      />
    );

    expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled();
  });

  it('LibraryPagination delegates to PaginationControls with identical visual structure', () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <LibraryPagination
        page={3}
        totalPages={10}
        canGoPrevious={true}
        canGoNext={true}
        onPageChange={onPageChange}
        t={mockT}
      />
    );

    expect(screen.getByText('第 3 / 10 页')).toBeInTheDocument();
    expect(container.querySelector('div.rounded-2xl')).toBeInTheDocument();
  });

  it('MyScoresPagination delegates to PaginationControls with identical visual structure', () => {
    const onPageChange = vi.fn();
    const { container } = render(
      <MyScoresPagination
        page={1}
        totalPages={4}
        canGoPrevious={false}
        canGoNext={true}
        onPageChange={onPageChange}
        t={mockT}
      />
    );

    expect(screen.getByText('第 1 / 4 页')).toBeInTheDocument();
    expect(container.querySelector('div.rounded-2xl')).toBeInTheDocument();
  });
});
