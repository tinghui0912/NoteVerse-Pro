'use client';

import {
  PaginationControls,
  type PaginationControlsProps,
} from '@/components/ui/pagination-controls';

export type MyScoresPaginationProps = PaginationControlsProps;

export function MyScoresPagination(props: MyScoresPaginationProps) {
  return <PaginationControls {...props} />;
}
