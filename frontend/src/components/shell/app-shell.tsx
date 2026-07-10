'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { HelpCircle, Library, Menu, Music2, Search, Settings, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { Link, usePathname, useRouter } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { LanguageSwitcher, NotificationBell, UserMenu } from '@/components/navigation/nav-actions';
import { cn } from '@/lib/utils';

const primaryNavItems = [
  { href: '/upload', label: 'nav.upload', icon: Upload },
  { href: '/my-scores', label: 'nav.myScores', icon: Music2 },
  { href: '/library', label: 'nav.library', icon: Library },
  { href: '/settings/profile', label: 'settings', icon: Settings, match: '/settings' },
] as const;

function AppSidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const t = useTranslations('common');
  const pathname = usePathname();

  const renderItem = (item: (typeof primaryNavItems)[number]) => {
    const Icon = item.icon;
    const match = 'match' in item ? item.match : item.href;
    const isActive = pathname === match || pathname.startsWith(`${match}/`);

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        className={cn(
          'flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors',
          isActive
            ? 'bg-orange-50 text-orange-700'
            : 'text-gray-600 hover:bg-gray-100 hover:text-gray-950'
        )}
      >
        <Icon className="h-4 w-4" />
        {t(item.label)}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col border-r border-gray-200 bg-white">
      <Link href="/upload" className="flex h-16 items-center gap-2 border-b border-gray-200 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-orange-500 text-white">
          <Music2 className="h-5 w-5" />
        </div>
        <span className="font-semibold tracking-tight text-gray-950">NoteVerse Pro</span>
      </Link>

      <nav className="flex-1 space-y-1 px-3 py-4">
        {primaryNavItems.map(renderItem)}
      </nav>
    </div>
  );
}

function AppTopbar({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const t = useTranslations('common');
  const searchParams = useSearchParams();
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const urlSearch = searchParams.get('search') ?? '';

  return (
    <>
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-4 backdrop-blur lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onOpenSidebar}
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">{t('openNavigation')}</span>
          </Button>
          <Button asChild className="hidden bg-orange-500 text-white hover:bg-orange-600 sm:inline-flex">
            <Link href="/upload">
              <Upload className="h-4 w-4" />
              {t('nav.upload')}
            </Link>
          </Button>
          <TopbarSearchForm
            key={`desktop-${urlSearch}`}
            initialSearch={urlSearch}
            className="ml-2 hidden w-full max-w-md md:block"
          />
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('searchScores')}
            className="rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-950 md:hidden"
            onClick={() => setMobileSearchOpen(true)}
          >
            <Search className="h-5 w-5" />
          </Button>
          <NotificationBell buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label={t('nav.help')}
            className="rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-950"
          >
            <Link href="/help">
              <HelpCircle className="h-5 w-5" />
            </Link>
          </Button>
          <LanguageSwitcher buttonClassName="text-gray-600 hover:bg-gray-100 hover:text-gray-950" />
          <UserMenu triggerClassName="hover:bg-gray-100" />
        </div>
      </header>

      <Dialog open={mobileSearchOpen} onOpenChange={setMobileSearchOpen}>
        <DialogContent className="top-24 translate-y-0 gap-4 rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('searchScores')}</DialogTitle>
          </DialogHeader>
          <TopbarSearchForm
            key={`mobile-${urlSearch}`}
            initialSearch={urlSearch}
            mobile
            onSubmitComplete={() => setMobileSearchOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function TopbarSearchForm({
  className,
  initialSearch,
  mobile = false,
  onSubmitComplete,
}: {
  className?: string;
  initialSearch: string;
  mobile?: boolean;
  onSubmitComplete?: () => void;
}) {
  const t = useTranslations('common');
  const router = useRouter();
  const [search, setSearch] = useState(initialSearch);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = search.trim();
    router.push(query ? `/library?search=${encodeURIComponent(query)}` : '/library');
    onSubmitComplete?.();
  };

  if (mobile) {
    return (
      <form onSubmit={submitSearch} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t('searchScores')}
            placeholder={t('searchScores')}
            className="h-11 rounded-full border-gray-200 bg-gray-50 pl-9"
          />
        </div>
        <Button type="submit" className="h-11 bg-orange-500 px-5 text-white hover:bg-orange-600">
          <Search className="h-4 w-4" />
          <span className="sr-only">{t('searchScores')}</span>
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={submitSearch} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        aria-label={t('searchScores')}
        placeholder={t('searchScores')}
        className="h-10 rounded-full border-gray-200 bg-gray-50 pl-9"
      />
    </form>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations('common');
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <AppSidebarContent />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={t('closeNavigation')}
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative h-full w-72 max-w-[85vw] bg-white shadow-xl">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2 z-10"
              onClick={() => setMobileOpen(false)}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">{t('closeNavigation')}</span>
            </Button>
            <AppSidebarContent onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-screen flex-col lg:pl-64">
        <AppTopbar onOpenSidebar={() => setMobileOpen(true)} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
