
'use client';

import { useTranslations } from 'next-intl';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Card, CardContent } from '@/components/ui/card';
import { Footer } from '@/components/layout/footer';

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
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-16">
          <Card className="bg-white p-8 rounded-2xl shadow-lg">
            <CardContent className="p-0">
              <Accordion type="single" collapsible className="w-full">
                {faqs.map((faq, index) => (
                  <AccordionItem key={index} value={`item-${index}`} className="border-b border-gray-200">
                    <AccordionTrigger className="py-6 text-lg font-medium text-left hover:no-underline text-gray-800">{t(faq.question as any) || faq.question}</AccordionTrigger>
                    <AccordionContent className="pb-6 text-gray-600">
                      {t(faq.answer as any) || faq.answer}
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
