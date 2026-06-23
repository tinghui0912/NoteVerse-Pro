'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bookmark, Gamepad2, Loader2, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { Link, routing } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { ListenModal } from '@/components/score/listen-modal';
import { useToast } from '@/hooks/use-toast';
import { scoreSharingApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';

export function ShareActions({
  canPractice,
  isAuthenticated,
  rawXml,
  scoreTitle,
  shareId,
  scoreId,
}: {
  canPractice: boolean;
  isAuthenticated: boolean;
  rawXml: string | null;
  scoreTitle: string;
  shareId: string;
  scoreId: string;
}) {
  const t = useTranslations('share');
  const common = useTranslations('common');
  const practice = useTranslations('practice');
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [listenOpen, setListenOpen] = useState(false);
  const localizedSharePath = locale === routing.defaultLocale ? `/share/${shareId}` : `/${locale}/share/${shareId}`;
  const query = searchParams.toString();
  const returnPath = `${pathname || localizedSharePath}${query ? `?${query}` : ''}`;
  const loginHref = `/login?returnUrl=${encodeURIComponent(returnPath)}`;
  const bookmark = useMutation({ mutationFn: () => scoreSharingApi.bookmark(shareId) });
  const save = () => bookmark.mutate(undefined, {
    onSuccess: () => toast({ title: t('saveSuccessTitle'), description: t('saveSuccessDesc', { scoreName: scoreTitle }) }),
    onError: (error) => toast({ title: t('saveFailed'), description: error instanceof ApiError ? error.message : t('saveFailedDesc'), variant: 'destructive' }),
  });
  const buttonClass = 'h-24 w-full rounded-2xl bg-white';

  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Button variant="outline" className={buttonClass} onClick={() => setListenOpen(true)} disabled={!rawXml}><span className="flex h-full flex-col items-center justify-center"><Play className="mb-2 h-6 w-6" />{common('play')}</span></Button>
        {canPractice ? <Link href={`/practice/${scoreId}?shareToken=${shareId}`}><Button variant="outline" className={buttonClass}><span className="flex h-full flex-col items-center justify-center"><Gamepad2 className="mb-2 h-6 w-6" />{practice('mode')}</span></Button></Link> : null}
        {isAuthenticated ? <Button variant="outline" className={buttonClass} onClick={save} disabled={bookmark.isPending}><span className="flex h-full flex-col items-center justify-center">{bookmark.isPending ? <Loader2 className="mb-2 h-6 w-6 animate-spin" /> : <Bookmark className="mb-2 h-6 w-6" />}{t('saveToHistory')}</span></Button> : <Link href={loginHref}><Button variant="outline" className={buttonClass}><span className="flex h-full flex-col items-center justify-center"><Bookmark className="mb-2 h-6 w-6" />{t('saveToHistory')}</span></Button></Link>}
      </div>
      <ListenModal isOpen={listenOpen} onOpenChange={setListenOpen} xmlString={rawXml} />
    </>
  );
}
