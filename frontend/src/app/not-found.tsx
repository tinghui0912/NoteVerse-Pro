'use client';

import Link from 'next/link';
import { Music } from 'lucide-react';
import { NotFoundState } from '@/components/states';
import { Button } from '@/components/ui/button';

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="bg-gray-50 antialiased">
        <div className="min-h-screen px-4">
          <div className="mx-auto flex h-16 max-w-7xl items-center">
            <Link href="/" className="inline-flex items-center gap-3 font-semibold text-gray-950">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500 text-white">
                <Music className="h-5 w-5" />
              </span>
              NoteVerse Pro
            </Link>
          </div>
          <NotFoundState
            title="Page Not Found"
            description="The page you are looking for does not exist or has been moved."
            className="min-h-[calc(100vh-4rem)]"
            action={
              <Button asChild size="lg">
                <Link href="/">Return Home</Link>
              </Button>
            }
          />
        </div>
      </body>
    </html>
  );
}
