import { Footer } from '@/components/layout/footer';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 text-white">
      <main className="flex min-h-screen items-center justify-center px-4 pb-12 pt-24">
        {children}
      </main>
      <Footer />
    </div>
  );
}
