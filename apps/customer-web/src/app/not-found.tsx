'use client';

import Link from 'next/link';
import { BrandMark } from '@/components/brand';
import { NotFoundState } from '@/components/states';
import { Button } from '@/components/ui/button';

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body className="bg-gray-50 antialiased">
        <div className="min-h-screen px-4">
          <div className="mx-auto flex h-16 max-w-7xl items-center">
            <Link href="/" className="inline-flex min-w-0 items-center gap-2 font-semibold tracking-tight text-gray-950">
              <BrandMark />
              <span className="truncate">NoteVerse Pro</span>
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
