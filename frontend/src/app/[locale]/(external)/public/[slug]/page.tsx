import type { Metadata } from 'next';
import { PublicScorePage } from '@/components/external/public-score-page';

async function fetchPublicTitle(slug: string): Promise<string | null> {
  const origin = process.env.NEXT_BACKEND_ORIGIN;
  if (!origin) return null;
  try {
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/v1/publications/${slug}`, {
      next: { revalidate: 60 },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { data?: { title?: string } };
    return payload.data?.title ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const title = await fetchPublicTitle(slug);
  return title ? { title } : {};
}

export default async function PublicPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicScorePage slug={slug} />;
}
