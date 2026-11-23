'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';

import { BrandLogo } from '@/components/brand';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

export function MarketingFooter({ ctaHref, ctaLabel }: { ctaHref: string; ctaLabel: string }) {
  const tHome = useTranslations('home');
  const tCommon = useTranslations('common');

  return (
    <footer className="border-t border-gray-200 bg-white py-12 text-gray-900" id="contact">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mb-12 flex flex-col items-start justify-between gap-6 rounded-lg border border-orange-100 bg-orange-50/70 p-6 lg:flex-row lg:items-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            {tHome('ctaTitle')}
          </h2>
          <Button asChild className="group bg-orange-500 px-6 py-3 font-semibold text-white hover:bg-orange-600">
            <Link href={ctaHref}>
              {ctaLabel}
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </Button>
        </div>
        <div className="border-t border-gray-200 pt-8">
          <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
            <BrandLogo markClassName="h-8 w-8" textClassName="font-headline text-xl" />
            <p className="text-sm text-gray-500">
              © {new Date().getFullYear()} NoteVerse Pro. {tCommon('allRightsReserved')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
