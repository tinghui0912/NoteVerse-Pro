
'use client';

import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { Footer } from '@/components/layout/footer';
import { Music2 } from 'lucide-react';
import React, { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SentContent() {
  const t = useTranslations('auth');
  const searchParams = useSearchParams();
  const email = searchParams.get('email');
  const [countdown, setCountdown] = useState(0);
  const [infoMessage, setInfoMessage] = useState('');

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleResend = () => {
    if (countdown > 0) return;
    // Add logic to resend the email
    console.log(`Resending email to ${email}`);
    setCountdown(60);
    setInfoMessage(t('codeResentMessage'));
    setTimeout(() => setInfoMessage(''), 5000); // Hide message after 5 seconds
  };

  return (
    <div className="w-full max-w-md text-center">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-orange-500/20 mb-8">
        <Music2 className="w-10 h-10 text-orange-400" />
      </div>
      <div className="relative flex justify-center items-center mb-4">
        <h1 className="text-4xl sm:text-6xl font-bold">{t('resetEmailSentTitle')}</h1>
      </div>
      <p 
        className="text-lg text-gray-400 mb-8 max-w-xl mx-auto"
        dangerouslySetInnerHTML={{ __html: t('resetEmailSentSubtitle', { email: '{email}' }).replace('{email}', `<span class="font-medium text-white">${email}</span>`) }}
      />
       {infoMessage && (
        <div className="bg-white/20 border border-white/20 text-white p-3 rounded-md text-sm mb-8">
            {infoMessage}
        </div>
      )}
      <div className="flex flex-col gap-4 pt-4">
        <Button size="lg" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold" asChild>
          <Link href="/login">{t('backToLogin')}</Link>
        </Button>
        <div className="text-sm text-muted-foreground text-center">
          <span>{t('didNotReceiveEmail')}</span>
          <Button
            type="button"
            variant="link"
            onClick={handleResend}
            disabled={countdown > 0}
            className="font-semibold text-white hover:underline p-0 h-auto ml-1"
          >
            {countdown > 0 ? `${t('resendAfter')} (${countdown}s)` : t('resend')}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordSentPage() {
  return (
    <div className="bg-gray-900 text-white">
      <main className="min-h-screen flex items-center justify-center pt-24 pb-12 px-4">
        <Suspense fallback={<div>Loading...</div>}>
          <SentContent />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
