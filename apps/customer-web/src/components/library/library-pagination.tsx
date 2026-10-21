'use client';

import {
  PaginationControls,
  type PaginationControlsProps,
} from '@/components/ui/pagination-controls';

export type LibraryPaginationProps = PaginationControlsProps;

export function LibraryPagination(props: LibraryPaginationProps) {
  return <PaginationControls {...props} />;
}
