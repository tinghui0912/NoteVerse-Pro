import { BrandLogo } from '@/components/brand';
import { LanguageSwitcher } from '@/components/navigation';

export default function GuestPreviewLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50"><header className="flex items-center justify-between border-b bg-white px-6 py-4"><BrandLogo /><LanguageSwitcher /></header>{children}</div>;
}
