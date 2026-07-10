
'use client';

import { useTranslations } from 'next-intl';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card, CardContent } from '@/components/ui/card';
import { MarketingFooter } from '@/components/marketing/marketing-footer';

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

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center">
          <h1 className="mb-4 text-4xl font-semibold tracking-tight text-gray-950 sm:text-5xl">{t('title')}</h1>
          <p className="text-lg text-gray-600">{t('subtitle')}</p>
        </div>
      </div>

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-16">
          <Card className="rounded-lg bg-white p-8 shadow-sm">
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
      <MarketingFooter />
    </div>
  );
}
