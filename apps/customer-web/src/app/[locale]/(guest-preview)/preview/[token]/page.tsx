import type { Metadata } from 'next';
import { GuestPreviewPage } from '@/features/scores/guest-preview/public-page';

export const metadata: Metadata = { robots: { index: false, follow: false, noarchive: true } };

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestPreviewPage token={token} />;
}
