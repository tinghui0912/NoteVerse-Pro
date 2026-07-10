'use client';

import { useTranslations } from 'next-intl';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { getSafeReturnUrl, withReturnUrl } from '@/lib/auth/return-url';
import { AuthCard } from '@/components/auth/auth-card';
import { InlineLoading } from '@/components/loading';
import { translateErrorCode } from '@/lib/i18n/error-message';

export default function LoginPage() {
    const t = useTranslations('auth');
    const tErrors = useTranslations('errors');
    const { isAuthenticated, isLoading: isAuthLoading, login } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasSubmittedLogin, setHasSubmittedLogin] = useState(false);
    const returnUrl = searchParams.get('returnUrl');

    useEffect(() => {
        if (!isAuthLoading && isAuthenticated && !hasSubmittedLogin) {
            router.replace('/library');
        }
    }, [hasSubmittedLogin, isAuthenticated, isAuthLoading, router]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);
        setHasSubmittedLogin(true);

        try {
            await login(email, password);
            // 从 URL 获取 returnUrl 参数，如果没有则跳转到 /upload
            router.push(getSafeReturnUrl(returnUrl));
        } catch (err) {
            // 使用前端翻译显示错误信息，而不是直接使用后端返回的中文
            if (err instanceof ApiError) {
                setError(translateErrorCode(tErrors, err.code, t('validation.loginError')));
            } else {
                setError(t('validation.loginFailed'));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const isLoading = isSubmitting;

    return (
        <AuthCard title={t('loginTitle')} subtitle={t('loginSubtitle')}>
                    {error && (
                        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleLogin} className="space-y-6">
                        <div className="space-y-2 text-left">
                            <Label htmlFor="email">{t('emailLabel')}</Label>
                            <Input
                                id="email"
                                type="email"
                                placeholder="name@example.com"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={isLoading}
                                className="h-12 border-gray-200 bg-white text-base text-gray-950 focus-visible:border-orange-500 focus-visible:ring-orange-100"
                            />
                        </div>
                        <div className="space-y-2 text-left">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">{t('passwordLabel')}</Label>
                                <Link
                                    href="/auth/forgot-password"
                                    className="text-sm font-medium text-orange-600 hover:text-orange-700 hover:underline"
                                >
                                    {t('forgotPassword')}
                                </Link>
                            </div>
                            <Input
                                id="password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                disabled={isLoading}
                                className="h-12 border-gray-200 bg-white text-base text-gray-950 focus-visible:border-orange-500 focus-visible:ring-orange-100"
                            />
                        </div>
                        <div className="flex flex-col gap-4 pt-4">
                            <Button
                                type="submit"
                                size="lg"
                                disabled={isLoading}
                                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                            >
                                {isLoading ? (
                                    <InlineLoading label={t('loggingIn')} />
                                ) : (
                                    t('loginButton')
                                )}
                            </Button>
                            <p className="text-sm text-muted-foreground">
                                {t('noAccount')}{' '}
                                <Link
                                    href={withReturnUrl('/auth/register', returnUrl)}
                                    className="font-semibold text-orange-600 hover:text-orange-700 hover:underline"
                                >
                                    {t('registerHere')}
                                </Link>
                            </p>
                        </div>
                    </form>
        </AuthCard>
    );
}
