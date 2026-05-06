
'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/routing';
import { Footer } from '@/components/layout/footer';
import { Music2 } from 'lucide-react';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const t = useTranslations('auth');
  const tProfile = useTranslations('profile');
  const router = useRouter();
  
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [confirmPasswordError, setConfirmPasswordError] = useState('');

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setConfirmPasswordError('');

    let hasError = false;
    if (!password) {
      setPasswordError(t('validation.passwordEmpty'));
      hasError = true;
    }
    if (password.length < 6) {
      setPasswordError(t('validation.passwordTooShort'));
      hasError = true;
    }
    if (password !== confirmPassword) {
      setConfirmPasswordError(t('validation.passwordsDoNotMatch'));
      hasError = true;
    }

    if (hasError) return;

    // Simulate API call
    console.log('Resetting password...');
    router.push('/login');
  };
  
  return (
    <div className="bg-gray-900 text-white">
      <main className="min-h-screen flex items-center justify-center pt-24 pb-12 px-4">
        <div className="w-full max-w-md text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-orange-500/20 mb-8">
                <Music2 className="w-10 h-10 text-orange-400" />
            </div>
            <h1 className="text-4xl sm:text-6xl font-bold mb-4">
                {t('setNewPasswordTitle')}
            </h1>
            <p className="text-lg text-gray-400 mb-12 max-w-xl mx-auto">
                {t('setNewPasswordSubtitle')}
            </p>
            <form onSubmit={handleResetPassword} className="space-y-6">
                <div className="space-y-2 text-left">
                  <Label htmlFor="password">{tProfile('newPassword')}</Label>
                  <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
                  />
                  {passwordError && <p className="text-sm text-destructive mt-2">{passwordError}</p>}
                </div>
                <div className="space-y-2 text-left">
                  <Label htmlFor="confirm-password">{t('confirmPasswordLabel')}</Label>
                  <Input
                      id="confirm-password"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
                  />
                  {confirmPasswordError && <p className="text-sm text-destructive mt-2">{confirmPasswordError}</p>}
                </div>
                <div className="flex flex-col gap-4 pt-4">
                    <Button type="submit" size="lg" className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold">
                        {t('resetPasswordButton')}
                    </Button>
                    <Button variant="link" asChild className="text-white">
                        <Link href="/login">{t('backToLogin')}</Link>
                    </Button>
                </div>
            </form>
        </div>
      </main>
      <Footer />
    </div>
  );
}
