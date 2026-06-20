'use client';

import { useState } from 'react';
import { Bookmark, Edit, Gamepad2, Loader2, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, routing } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { ListenModal } from '@/components/score/listen-modal';
import { useToast } from '@/hooks/use-toast';
import { useSaveToCollection } from '@/hooks/queries/use-share-queries';
import { ApiError } from '@/lib/api-client';

interface ShareActionsProps {
  canEdit: boolean;
  rawXml: string | null;
  scoreTitle: string;
  shareId: string;
  taskId: string;
}

export function ShareActions({ canEdit, rawXml, scoreTitle, shareId, taskId }: ShareActionsProps) {
  const t = useTranslations('share');
  const common = useTranslations('common');
  const practice = useTranslations('practice');
  const locale = useLocale();
  const { toast } = useToast();
  const save = useSaveToCollection();
  const [listenOpen, setListenOpen] = useState(false);
  const buttonClass = 'h-24 w-full rounded-2xl bg-white';
  const returnPath = locale === routing.defaultLocale ? `/share/${shareId}` : `/${locale}/share/${shareId}`;
  const editorHref = `/editor/${taskId}?source=final&shareToken=${shareId}&returnUrl=${encodeURIComponent(returnPath)}`;

  const bookmark = () => save.mutate(shareId, {
    onSuccess: () => toast({ title: t('saveSuccessTitle'), description: t('saveSuccessDesc', { scoreName: scoreTitle }) }),
    onError: (error) => toast({ title: t('saveFailed'), description: error instanceof ApiError ? error.message : t('saveFailedDesc'), variant: 'destructive' }),
  });

  return (
    <>
      <div className={`grid grid-cols-2 gap-4 ${canEdit ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
        <Button variant="outline" className={buttonClass} onClick={() => setListenOpen(true)} disabled={!rawXml}><span className="flex h-full flex-col items-center justify-center"><Play className="mb-2 h-6 w-6" />{common('play')}</span></Button>
        <Link href={`/practice/${taskId}?shareToken=${shareId}`}><Button variant="outline" className={buttonClass}><span className="flex h-full flex-col items-center justify-center"><Gamepad2 className="mb-2 h-6 w-6" />{practice('mode')}</span></Button></Link>
        {canEdit ? <Link href={editorHref}><Button variant="outline" className={buttonClass}><span className="flex h-full flex-col items-center justify-center"><Edit className="mb-2 h-6 w-6" />{common('edit')}</span></Button></Link> : null}
        <Button variant="outline" className={buttonClass} onClick={bookmark} disabled={save.isPending}><span className="flex h-full flex-col items-center justify-center">{save.isPending ? <Loader2 className="mb-2 h-6 w-6 animate-spin" /> : <Bookmark className="mb-2 h-6 w-6" />}{t('saveToHistory')}</span></Button>
      </div>
      <ListenModal
        isOpen={listenOpen}
        onOpenChange={setListenOpen}
        xmlString={rawXml}
        backend="verovio"
      />
    </>
  );
}
