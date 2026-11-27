import { Suspense } from 'react';
import InvitePage from '@/features/scores/collaboration/invite-page';
export default async function InviteRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Suspense fallback={null}><InvitePage token={token} /></Suspense>;
}
