'use client';

import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface InsertionCaretProps {
  onClick: () => void;
  className?: string;
}

export function InsertionCaret({ onClick, className }: InsertionCaretProps) {
  return (
    <button
      type="button"
      aria-label="Insert"
      className={cn(
        'group relative flex h-29.5 w-6 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-primary/5 focus-visible:bg-primary/10',
        className
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <span className="h-20 w-0.5 rounded-full bg-border transition-all group-hover:h-24 group-hover:w-1 group-hover:bg-primary group-focus-visible:h-24 group-focus-visible:w-1 group-focus-visible:bg-primary" />
      <span className="absolute top-1/2 flex h-5 w-5 -translate-y-1/2 scale-75 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow-md transition-all group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
        <Plus className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}