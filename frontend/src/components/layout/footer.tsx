
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

  const ctaLink = isAuthenticated ? '/upload' : '/login';

  return (
    <footer className="bg-black text-white py-16" id="contact">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-16 gap-8">
            <h2 className="text-4xl sm:text-5xl font-medium">
              {tHome('ctaTitle')}
            </h2>
            <Link href={ctaLink}>
              <Button className="bg-orange-500 hover:bg-orange-600 text-white font-semibold group px-8 py-3">
                {tHome('ctaButton')}
                <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            </Link>
          </div>
          <div className="border-t border-gray-800 pt-8 mt-16">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
               <div className="flex items-center gap-2">
                <Music2 className="h-6 w-6 text-primary" />
                <span className="font-headline text-xl font-bold">
                  NoteVerse Pro
                </span>
              </div>
              <p className="text-gray-500 text-sm">© {new Date().getFullYear()} NoteVerse Pro. {tCommon('allRightsReserved')}</p>
              <div className="flex space-x-6 text-sm text-gray-400">
                <a href="#" className="hover:text-white transition-colors">{tCommon('privacyPolicy')}</a>
                <a href="#" className="hover:text-white transition-colors">{tCommon('termsOfService')}</a>
              </div>
            </div>
          </div>
        </div>
      </footer>
  );
}