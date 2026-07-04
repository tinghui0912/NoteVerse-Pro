'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { Footer } from '@/components/layout/footer';
import { Music2, Loader2 } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const tProfile = useTranslations('profile');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const { sendEmailCode, verifyPasswordResetCode, resetPassword } = useAuth();

  const [step, setStep] = useState<'enter_email' | 'verify_code' | 'new_password'>('enter_email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(new Array(6).fill(''));
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [confirmPasswordValue, setConfirmPasswordValue] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [verifiedToken, setVerifiedToken] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [emailError, setEmailError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    let timer: NodeJS.Timeout | undefined;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (step === 'verify_code' && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [step]);

  // 发送验证码
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');

    if (!email) {
      setEmailError(t('validation.emailRequired'));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailError(t('validation.invalidEmail'));
      return;
    }

    setIsSubmitting(true);
    try {
      const challengeIdResult = await sendEmailCode(email, 'password_reset', locale === 'en' ? 'en' : 'zh');
      setChallengeId(challengeIdResult);
      setCountdown(60);
      setStep('verify_code');
    } catch (err) {
      if (err instanceof ApiError) {
        setEmailError(translateErrorCode(tErrors, err.code, err.message || t('sendCodeFailed')));
      } else {
        setEmailError(t('sendCodeFailedRetry'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 验证验证码
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError('');
    const enteredCode = code.join('');
    if (enteredCode.length !== 6) {
      setCodeError(t('validation.codeInvalid'));
      return;
    }

    setIsSubmitting(true);
    try {
      const token = await verifyPasswordResetCode(email, enteredCode, challengeId);
      setVerifiedToken(token);
      setStep('new_password');
    } catch (err) {
      if (err instanceof ApiError) {
        setCodeError(translateErrorCode(tErrors, err.code, err.message || t('verifyFailed')));
      } else {
        setCodeError(t('verifyFailedRetry'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重置密码
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (newPasswordValue.length < 6) {
      setPasswordError(t('validation.passwordTooShort'));
      return;
    }
    if (newPasswordValue !== confirmPasswordValue) {
      setPasswordError(t('validation.passwordsDoNotMatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      await resetPassword(email, newPasswordValue, verifiedToken);
      router.push('/login?reset=success');
    } catch (err) {
      if (err instanceof ApiError) {
        setPasswordError(translateErrorCode(tErrors, err.code, err.message || t('resetFailed')));
      } else {
        setPasswordError(t('resetFailedRetry'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCodeChange = (element: HTMLInputElement, index: number) => {
    if (isNaN(Number(element.value))) return;
    const newCode = [...code];
    newCode[index] = element.value;
    setCode(newCode);
    if (element.nextSibling && element.value) {
      (element.nextSibling as HTMLInputElement).focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
    if (e.key === 'Backspace' && !code[index] && inputRefs.current[index - 1]) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasteData = e.clipboardData.getData('text');
    if (/^\d{6}$/.test(pasteData)) {
      const newCode = pasteData.split('');
      setCode(newCode);
      if (inputRefs.current[5]) {
        inputRefs.current[5]?.focus();
      }
    }
  };

  const renderEmailStep = () => (
    <>
      <h1 className="text-4xl sm:text-6xl font-bold mb-4">{t('resetPasswordTitle')}</h1>
      <p className="text-lg text-gray-400 mb-12 max-w-xl mx-auto">{t('resetPasswordSubtitle')}</p>
      <form onSubmit={handleSendCode} className="space-y-6">
        <div className="space-y-2 text-left">
          <Label htmlFor="email">{t('emailLabel')}</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isSubmitting}
            className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
          />
          {emailError && <p className="text-sm text-destructive mt-2">{emailError}</p>}
        </div>
        <div className="flex flex-col gap-4 pt-4">
          <Button type="submit" size="lg" disabled={isSubmitting} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold">
            {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('sendingCode')}</> : t('verifyEmailButton')}
          </Button>
          <Button variant="link" asChild className="text-white">
            <Link href="/login">{t('backToLogin')}</Link>
          </Button>
        </div>
      </form>
    </>
  );

  const renderCodeStep = () => (
    <>
      <h1 className="text-4xl sm:text-6xl font-bold mb-4">{t('enterCodeTitle')}</h1>
      <p className="text-lg text-gray-400 mb-8 max-w-xl mx-auto" dangerouslySetInnerHTML={{ __html: t('enterCodeSubtitle', { email: '{email}' }).replace('{email}', email) }} />
      <form onSubmit={handleVerifyCode} className="space-y-8">
        <div className="text-left space-y-2" onPaste={handlePaste}>
          <Label>{t('codeLabel')}</Label>
          <div className="flex justify-between gap-2">
            {code.map((digit, index) => (
              <Input
                key={index}
                ref={(el: HTMLInputElement | null) => { inputRefs.current[index] = el; }}
                type="text"
                maxLength={1}
                value={digit}
                onChange={e => handleCodeChange(e.target, index)}
                onKeyDown={e => handleKeyDown(e, index)}
                onFocus={e => e.target.select()}
                disabled={isSubmitting}
                className="h-14 flex-1 text-2xl text-center font-mono bg-gray-800 border-gray-700 text-white focus-visible:ring-transparent focus-visible:border-white"
              />
            ))}
          </div>
          {codeError && <p className="text-sm text-destructive mt-2">{codeError}</p>}
        </div>
        <Button type="submit" size="lg" disabled={isSubmitting} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold">
          {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('verifyingCode')}</> : t('verifyButton')}
        </Button>
      </form>
    </>
  );

  const renderPasswordStep = () => (
    <>
      <h1 className="text-4xl sm:text-6xl font-bold mb-4">{t('setNewPasswordTitle')}</h1>
      <p className="text-lg text-gray-400 mb-8 max-w-xl mx-auto">{t('enterNewPassword')}</p>
      <form onSubmit={handleResetPassword} className="space-y-6">
        <div className="space-y-2 text-left">
          <Label htmlFor="new-password">{tProfile('newPassword')}</Label>
          <Input
            id="new-password"
            type="password"
            value={newPasswordValue}
            onChange={(e) => setNewPasswordValue(e.target.value)}
            disabled={isSubmitting}
            className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
          />
        </div>
        <div className="space-y-2 text-left">
          <Label htmlFor="confirm-password">{t('confirmPasswordLabel')}</Label>
          <Input
            id="confirm-password"
            type="password"
            value={confirmPasswordValue}
            onChange={(e) => setConfirmPasswordValue(e.target.value)}
            disabled={isSubmitting}
            className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
          />
          {passwordError && <p className="text-sm text-destructive mt-2">{passwordError}</p>}
        </div>
        <Button type="submit" size="lg" disabled={isSubmitting} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold">
          {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('resettingPassword')}</> : t('resetPasswordButton')}
        </Button>
      </form>
    </>
  );

  return (
    <div className="bg-gray-900 text-white">
      <main className="min-h-screen flex items-center justify-center pt-24 pb-12 px-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-orange-500/20 mb-8">
            <Music2 className="w-10 h-10 text-orange-400" />
          </div>
          {step === 'enter_email' && renderEmailStep()}
          {step === 'verify_code' && renderCodeStep()}
          {step === 'new_password' && renderPasswordStep()}
        </div>
      </main>
      <Footer />
    </div>
  );
}
