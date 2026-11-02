import type { Metadata } from 'next';
import { GuestPreviewPage } from '@/components/external/guest-preview-page';

export const metadata: Metadata = { robots: { index: false, follow: false, noarchive: true } };

export default async function PreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestPreviewPage token={token} />;
}
