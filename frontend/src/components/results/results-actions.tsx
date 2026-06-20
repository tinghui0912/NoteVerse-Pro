'use client';

import { useState } from 'react';
import { Edit, Gamepad2, Hand, Loader2, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { ListenModal } from '@/components/score/listen-modal';
import { useToast } from '@/hooks/use-toast';
import { useGenerateFingering } from '@/hooks/queries/use-xml-queries';
import { ApiError } from '@/lib/api-client';

export function ResultsActions({ taskId, rawXml }: { taskId: string; rawXml: string }) {
  const t = useTranslations('results');
  const common = useTranslations('common');
  const practice = useTranslations('practice');
  const errors = useTranslations('errors');
  const { toast } = useToast();
  const fingering = useGenerateFingering();
  const [listenOpen, setListenOpen] = useState(false);

  const generateFingering = () => {
    fingering.mutate(
      { taskId },
      {
        onSuccess: (response) => toast(response.success
          ? { title: t('fingeringSuccess'), description: t('fingeringDesc') }
          : { title: t('fingeringFailed'), description: response.message || t('fingeringFailed'), variant: 'destructive' }),
        onError: (error) => toast({
          title: t('fingeringFailed'),
          description: error instanceof ApiError && error.code ? errors(error.code as never) : t('fingeringFailedDesc'),
          variant: 'destructive',
        }),
      }
    );
  };

  const buttonClass = 'h-24 w-full rounded-2xl bg-white';
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Button variant="outline" className={buttonClass} onClick={generateFingering} disabled={fingering.isPending}>
          <span className="flex h-full flex-col items-center justify-center">
            {fingering.isPending ? <Loader2 className="mb-2 h-6 w-6 animate-spin" /> : <Hand className="mb-2 h-6 w-6" />}
            {t('generateFingering')}
          </span>
        </Button>
        <Button variant="outline" className={buttonClass} onClick={() => setListenOpen(true)}>
          <span className="flex h-full flex-col items-center justify-center"><Play className="mb-2 h-6 w-6" />{common('play')}</span>
        </Button>
        <Link href={`/practice/${taskId}`}><Button variant="outline" className={buttonClass}><span className="flex h-full flex-col items-center justify-center"><Gamepad2 className="mb-2 h-6 w-6" />{practice('mode')}</span></Button></Link>
        <Link href={`/editor/${taskId}?source=final`}><Button variant="outline" className={buttonClass}><span className="flex h-full flex-col items-center justify-center"><Edit className="mb-2 h-6 w-6" />{common('edit')}</span></Button></Link>
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
