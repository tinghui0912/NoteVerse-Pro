'use client';

import { useTranslations } from 'next-intl';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Link } from '@/i18n/routing';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { Footer } from '@/components/layout/footer';
import { Music2, Loader2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';

function getSafeReturnUrl(value: string | null): string {
    if (!value || !value.startsWith('/') || value.startsWith('//')) {
        return '/upload';
    }

    return value;
}

export default function LoginPage() {
    const t = useTranslations('auth');
    const { login } = useAuth();
    const router = useRouter();

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsSubmitting(true);

        try {
            await login(email, password);
            // 从 URL 获取 returnUrl 参数，如果没有则跳转到 /upload
            const searchParams = new URLSearchParams(window.location.search);
            const returnUrl = getSafeReturnUrl(searchParams.get('returnUrl'));
            router.push(returnUrl);
        } catch (err) {
            // 使用前端翻译显示错误信息，而不是直接使用后端返回的中文
            if (err instanceof ApiError && err.status === 401) {
                setError(t('validation.loginError'));
            } else {
                setError(t('validation.loginFailed'));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const isLoading = isSubmitting;

    return (
        <div className="bg-gray-900 text-white">
            <main className="min-h-screen flex items-center justify-center pt-24 pb-12 px-4">
                <div className="w-full max-w-md text-center">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-orange-500/20 mb-8">
                        <Music2 className="w-10 h-10 text-orange-400" />
                    </div>
                    <h1 className="text-4xl sm:text-6xl font-bold mb-4">
                        {t('loginTitle')}
                    </h1>
                    <p className="text-lg text-gray-400 mb-12 max-w-xl mx-auto">
                        {t('loginSubtitle')}
                    </p>

                    {error && (
                        <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
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
                                className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
                            />
                        </div>
                        <div className="space-y-2 text-left">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="password">{t('passwordLabel')}</Label>
                                <Link
                                    href="/forgot-password"
                                    className="text-sm text-white hover:underline"
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
                                className="bg-gray-800 border-gray-700 text-white h-12 text-base focus-visible:ring-transparent focus-visible:border-white"
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
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {t('loggingIn')}
                                    </>
                                ) : (
                                    t('loginButton')
                                )}
                            </Button>
                            <p className="text-sm text-muted-foreground">
                                {t('noAccount')}{' '}
                                <Link
                                    href="/register"
                                    className="font-semibold text-white hover:underline"
                                >
                                    {t('registerHere')}
                                </Link>
                            </p>
                        </div>
                    </form>
                </div>
            </main>
            <Footer />
        </div>
    );
}
