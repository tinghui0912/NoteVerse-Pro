
'use client';

import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Footer } from '@/components/layout/footer';
import { useAuth } from '@/contexts/auth-context';
import { Link } from '@/i18n/routing';

const faqs = [
  {
    question: 'faq1Title',
    answer: 'faq1Answer',
  },
  {
    question: 'faq2Title',
    answer: 'faq2Answer',
  },
  {
    question: 'faq3Title',
    answer: 'faq3Answer',
  },
  {
    question: 'faq4Title',
    answer: 'faq4Answer',
  },
];

export default function HelpPage() {
  const t = useTranslations('help');
  const { isAuthenticated } = useAuth();

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-16">
          {isAuthenticated ? (
            <div className="mb-8 flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-900">{t('signedInHelpTitle')}</p>
                <p className="mt-1 text-sm text-gray-600">{t('signedInHelpDesc')}</p>
              </div>
              <Button asChild variant="outline">
                <Link href="/library">
                  <ArrowLeft className="h-4 w-4" />
                  {t('backToApp')}
                </Link>
              </Button>
            </div>
          ) : null}
          <Card className="bg-white p-8 rounded-2xl shadow-lg">
            <CardContent className="p-0">
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`} className="border-b border-gray-200">
                    <AccordionTrigger className="py-6 text-lg font-medium text-left hover:no-underline text-gray-800">{t(faq.question as never) || faq.question}</AccordionTrigger>
                    <AccordionContent className="pb-6 text-gray-600">
                      {t(faq.answer as never) || faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
