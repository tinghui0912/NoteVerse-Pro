'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { Footer } from '@/components/layout/footer';
import { Music2, Loader2 } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { ApiError } from '@/lib/api-client';
import { getSafeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';
import { translateErrorCode } from '@/lib/i18n/error-message';

export default function RegisterPage() {
  const t = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const locale = useLocale();
  const { register, sendEmailCode, verifyEmailCode } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState<'enter_details' | 'verify_code'>('enter_details');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState(new Array(6).fill(''));
  const [countdown, setCountdown] = useState(0);
  const [infoMessage, setInfoMessage] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [codeError, setCodeError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const returnUrl = searchParams.get('returnUrl');

  // 存储 challenge_id 和 verified_token
  const [challengeId, setChallengeId] = useState('');

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

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setPasswordError('');
    setInfoMessage('');

    if (!email) {
      setEmailError(t('validation.emailEmpty'));
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setEmailError(t('validation.emailInvalid'));
      return;
    }
    if (!password) {
      setPasswordError(t('validation.passwordEmpty'));
      return;
    }
    if (password.length < 6) {
      setPasswordError(t('validation.passwordTooShort'));
      return;
    }

    setIsSubmitting(true);
    try {
      const challengeIdResult = await sendEmailCode(email, 'register', locale === 'en' ? 'en' : 'zh');
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

  const handleResendCode = async () => {
    if (countdown > 0) return;

    setIsSubmitting(true);
    try {
      const challengeIdResult = await sendEmailCode(email, 'register', locale === 'en' ? 'en' : 'zh');
      setChallengeId(challengeIdResult);
      setCountdown(60);
      setInfoMessage(t('codeSent'));
      setTimeout(() => setInfoMessage(''), 5000);
    } catch (err) {
      if (err instanceof ApiError) {
        setCodeError(translateErrorCode(tErrors, err.code, err.message || t('resendFailed')));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

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
      // 第一步：验证验证码，获取 verified_token
      const token = await verifyEmailCode(email, enteredCode, challengeId);

      // 第二步：注册（会自动登录）
      await register(email, password, displayName || email.split('@')[0], token);

      router.push(getSafeReturnUrl(returnUrl));
    } catch (err) {
      if (err instanceof ApiError) {
        setCodeError(translateErrorCode(tErrors, err.code, err.message || t('verifyFailed')));
      } else {
        setCodeError(t('registerFailed'));
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

    // Focus next input
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

  const isLoading = isSubmitting;

  const renderStepOne = () => (
    <>
      <h1 className="text-4xl sm:text-6xl font-bold mb-4">{t('registerTitle')}</h1>
      <p className="text-lg text-gray-400 mb-12 max-w-xl mx-auto">{t('registerSubtitle')}</p>
      <form onSubmit={handleSendCode} className="space-y-6">
        <div className="space-y-2 text-left">
          <Label htmlFor="email">{t('emailLabel')}</Label>
          <Input
            id="email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
            className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
          />
          {emailError && <p className="text-sm text-destructive mt-2">{emailError}</p>}
        </div>
        <div className="space-y-2 text-left">
          <Label htmlFor="displayName">{t('displayNameLabel')}</Label>
          <Input
            id="displayName"
            type="text"
            placeholder={t('displayNamePlaceholder')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={isLoading}
            className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
          />
        </div>
        <div className="space-y-2 text-left">
          <Label htmlFor="password">{t('passwordLabel')}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
            className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
          />
          {passwordError && <p className="text-sm text-destructive mt-2">{passwordError}</p>}
        </div>
        <div className="flex flex-col gap-4 pt-4">
          <Button
            type="submit"
            size="lg"
            disabled={isLoading}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('sendingCode')}
              </>
            ) : (
              t('registerButton')
            )}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t('haveAccount')}{' '}
            <Link href={withReturnUrl('/login', returnUrl)} className="font-semibold text-white hover:underline">
              {t('loginHere')}
            </Link>
          </p>
        </div>
      </form>
    </>
  );

  const renderStepTwo = () => (
    <>
      <h1 className="text-4xl sm:text-6xl font-bold mb-4">{t('enterCodeTitle')}</h1>
      <p
        className="text-lg text-gray-400 mb-4 max-w-xl mx-auto"
        dangerouslySetInnerHTML={{ __html: t('enterCodeSubtitle', { email: '{email}' }).replace('{email}', email) }}
      />
      {infoMessage && (
        <div className="bg-white/20 border border-white/20 text-white p-3 rounded-md text-sm mb-8">
          {infoMessage}
        </div>
      )}
      <form onSubmit={handleVerifyCode} className="space-y-8">
        <div className="text-left space-y-2" onPaste={handlePaste}>
          <Label htmlFor="code-0">{t('codeLabel')}</Label>
          <div className="flex justify-between gap-2">
            {code.map((digit, index) => (
              <Input
                key={index}
                id={`code-${index}`}
                ref={(el: HTMLInputElement | null) => { inputRefs.current[index] = el; }}
                type="text"
                maxLength={1}
                value={digit}
                onChange={e => handleCodeChange(e.target, index)}
                onKeyDown={e => handleKeyDown(e, index)}
                onFocus={e => e.target.select()}
                disabled={isLoading}
                className="h-14 flex-1 text-2xl text-center font-mono bg-gray-800 border-gray-700 text-white focus-visible:ring-transparent focus-visible:border-white"
              />
            ))}
          </div>
          {codeError && <p className="text-sm text-destructive mt-2">{codeError}</p>}
        </div>
        <div className="flex flex-col gap-4 pt-4">
          <Button
            type="submit"
            size="lg"
            disabled={isLoading}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('verifyingCode')}
              </>
            ) : (
              t('verifyEmailButton')
            )}
          </Button>
          <div className="text-sm text-muted-foreground text-center">
            <span>{t('didNotReceiveCode')}</span>
            <Button
              type="button"
              variant="link"
              onClick={handleResendCode}
              disabled={countdown > 0 || isLoading}
              className="font-semibold text-white hover:underline p-0 h-auto ml-1"
            >
              {countdown > 0 ? `${t('resendAfter')} (${countdown}s)` : t('resend')}
            </Button>
          </div>
        </div>
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
          {step === 'enter_details' ? renderStepOne() : renderStepTwo()}
        </div>
      </main>
      <Footer />
    </div>
  );
}
