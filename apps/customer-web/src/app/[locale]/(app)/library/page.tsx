import LibraryPage from '@/features/library/library-page';
import type { LibrarySearchParams } from '@/features/library/route-state';

export default async function LibraryRoute({
  searchParams,
}: {
  searchParams: Promise<LibrarySearchParams>;
}) {
  return <LibraryPage params={await searchParams} />;
}
