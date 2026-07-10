
'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { ArrowRight, Music2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '../ui/button';

export function Footer() {
  const tHome = useTranslations('home');
  const tCommon = useTranslations('common');
  const { isAuthenticated } = useAuth();

  const ctaLink = isAuthenticated ? '/upload' : '/auth/login';

  return (
    <footer className="border-t border-gray-200 bg-white py-12 text-gray-900" id="contact">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mb-12 flex flex-col items-start justify-between gap-6 rounded-lg border border-orange-100 bg-orange-50/70 p-6 lg:flex-row lg:items-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {tHome('ctaTitle')}
            </h2>
            <Link href={ctaLink}>
              <Button className="group bg-orange-500 px-6 py-3 font-semibold text-white hover:bg-orange-600">
                {tHome('ctaButton')}
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
          <div className="border-t border-gray-200 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
               <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-500 text-white">
                  <Music2 className="h-5 w-5" />
                </span>
                <span className="font-headline text-xl font-semibold tracking-tight">
                  NoteVerse Pro
                </span>
              </div>
              <p className="text-sm text-gray-500">© {new Date().getFullYear()} NoteVerse Pro. {tCommon('allRightsReserved')}</p>
              <div className="flex space-x-6 text-sm text-gray-500">
                <a href="#" className="transition-colors hover:text-gray-950">{tCommon('privacyPolicy')}</a>
                <a href="#" className="transition-colors hover:text-gray-950">{tCommon('termsOfService')}</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
  );
}
