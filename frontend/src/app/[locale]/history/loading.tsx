'use client';

import { Skeleton } from '@/components/ui/skeleton';

export default function HistoryLoading() {
  return (
    <div className="container max-w-6xl py-8 space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="space-y-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
