import './globals.css';
import { connection } from 'next/server';
import { headers } from 'next/headers';
import { SecurityDocumentBoundary } from '@/lib/security/document-boundary';
import type { BrowserPolicy } from '@/lib/security/route-policy';

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  const requestHeaders = await headers();
  const policy = requestHeaders.get('x-browser-policy') as BrowserPolicy;
  return <SecurityDocumentBoundary policy={policy}>{children}</SecurityDocumentBoundary>;
}
