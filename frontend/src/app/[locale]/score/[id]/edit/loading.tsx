'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

export default function EditorLoading() {
  return (
    <div className="flex h-screen w-full bg-gray-50/50 overflow-hidden animate-in fade-in duration-500">
      {/* Sidebar Skeleton */}
      <div className="w-64 border-r bg-white p-4 hidden md:flex flex-col gap-4">
        <Skeleton className="h-8 w-3/4 mb-4" />
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>

      {/* Main Content Skeleton */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-14 border-b bg-white flex items-center px-4 justify-between">
          <Skeleton className="h-8 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </div>

        {/* Canvas Area */}
        <div className="flex-1 p-8 flex items-center justify-center bg-gray-100/50">
           <div className="flex flex-col items-center gap-4 text-gray-400">
             <Loader2 className="w-12 h-12 animate-spin text-orange-400/50" />
             <Skeleton className="h-6 w-48" />
           </div>
        </div>
      </div>
    </div>
  );
}
