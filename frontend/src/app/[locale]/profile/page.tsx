'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/auth-context';
import { placeholderImages } from '@/lib/placeholder-images';
import { Camera, Crown, Save, Loader2, User } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Footer } from '@/components/layout/footer';
import React, { useRef, useState } from 'react';
import { AvatarCropperModal } from '@/components/avatar-cropper-modal';
import { useUploadAvatar, useUpdateProfile, useChangePassword } from '@/hooks/queries/use-profile-mutations';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

export default function ProfilePage() {
  const t = useTranslations('profile');
  const tCommon = useTranslations('common');
  const tAuth = useTranslations('auth');
  const tErrors = useTranslations('errors');
  const { user, setUser, refreshUser } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);

  // 琛ㄥ崟鐘舵€?
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const username = usernameDraft ?? user?.name ?? '';
  const email = user?.email ?? '';
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // 鍔犺浇鐘舵€?
  const avatarMutation = useUploadAvatar();
  const profileMutation = useUpdateProfile();
  const passwordMutation = useChangePassword();

  const handleCameraClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setUploadedImage(reader.result as string);
        setIsCropperOpen(true);
      };
      reader.readAsDataURL(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 涓婁紶瑁佸壀鍚庣殑澶村儚
  const handleCroppedImage = async (imageDataUrl: string) => {
    // 灏?data URL 杞崲涓?File
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const file = new File([blob], 'avatar.png', { type: 'image/png' });

    avatarMutation.mutate(file, {
      onSuccess: (result) => {
        if (result.data?.avatar_url) {
          const avatarUrlWithCacheBuster = `${result.data.avatar_url}?t=${Date.now()}`;
          if (user) {
            setUser({ ...user, avatar: avatarUrlWithCacheBuster });
          }
          toast({
            title: t('avatarSuccess'),
            description: t('avatarUpdated'),
          });
        }
      },
      onError: (error) => {
        toast({
          title: t('uploadFailed'),
          description: error instanceof ApiError && error.code ? tErrors(error.code as never) : t('uploadFailedDesc'),
          variant: 'destructive',
        });
      },
    });
  };

  // 鏇存柊涓汉璧勬枡
  const handleUpdateProfile = () => {
    profileMutation.mutate({ display_name: username !== user?.name ? username : undefined }, {
      onSuccess: async () => {
        setUsernameDraft(null);
        await refreshUser();
        toast({
          title: t('updateSuccess'),
          description: t('profileUpdated'),
        });
      },
      onError: (error) => {
        toast({
          title: t('updateFailed'),
          description: error instanceof ApiError && error.code ? tErrors(error.code as never) : t('updateFailedDesc'),
          variant: 'destructive',
        });
      },
    });
  };

  // 淇敼瀵嗙爜
  const handleUpdatePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: t('passwordMismatchTitle'),
        description: t('passwordMismatch'),
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: t('passwordTooShortTitle'),
        description: tAuth('validation.passwordTooShort'),
        variant: 'destructive',
      });
      return;
    }

    passwordMutation.mutate({ currentPassword, newPassword }, {
      onSuccess: () => {
        toast({
          title: t('passwordSuccess'),
          description: t('passwordUpdated'),
        });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      },
      onError: (error) => {
        toast({
          title: t('passwordFailed'),
          description: error instanceof ApiError && error.code ? tErrors(error.code as never) : t('passwordFailedDesc'),
          variant: 'destructive',
        });
      },
    });
  };

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>

      <main className="flex-grow">
        <div className="max-w-2xl mx-auto px-4 py-16">
          <div className="space-y-8">
            <Card className="bg-white p-6 rounded-2xl shadow-lg">
              <CardContent className="space-y-4 pt-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <Avatar className="h-16 w-16">
                        <AvatarImage src={user?.avatar || placeholderImages['avatar-user'].url} />
                        <AvatarFallback>
                          <User className="h-8 w-8 text-gray-400" />
                        </AvatarFallback>
                      </Avatar>
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/*"
                        className="hidden"
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-white/80 backdrop-blur-sm shadow"
                        onClick={handleCameraClick}
                        disabled={avatarMutation.isPending}
                      >
                        {avatarMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Camera className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <div>
                      <p className="text-lg font-semibold">{user?.name}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Crown className="h-4 w-4 text-orange-500" />
                        <p className="text-sm font-medium text-orange-500">{tCommon('freePlan')}</p>
                      </div>
                    </div>
                  </div>
                  <Button asChild className="bg-orange-500 hover:bg-orange-600 text-white font-semibold group px-6 py-3 rounded-full">
                    <Link href="/subscriptions">
                      <Crown className="h-4 w-4 mr-2" />
                      {tCommon('upgrade')}
                    </Link>
                  </Button>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="username">{tAuth('usernameLabel')}</Label>
                    <Input
                      id="username"
                      value={username}
                      onChange={(e) => setUsernameDraft(e.target.value)}
                      className="bg-white h-12"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">{tAuth('emailLabel')}</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      disabled
                      className="bg-gray-100 h-12"
                    />
                  </div>
                  <Button
                    size="lg"
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                    onClick={handleUpdateProfile}
                    disabled={profileMutation.isPending}
                  >
                    {profileMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    {t('updateProfile')}
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-white p-6 rounded-2xl shadow-lg">
              <CardHeader className="p-0 pb-6">
                <CardTitle>{t('changePassword')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-0">
                <div className="space-y-2">
                  <Label htmlFor="current-password">{t('currentPassword')}</Label>
                  <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="bg-white h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">{t('newPassword')}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="bg-white h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">{tAuth('confirmPasswordLabel')}</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="bg-white h-12"
                  />
                </div>
                <Button
                  size="lg"
                  className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                  onClick={handleUpdatePassword}
                  disabled={passwordMutation.isPending}
                >
                  {passwordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('updatePassword')}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
      <Footer />
      {uploadedImage && (
        <AvatarCropperModal
          isOpen={isCropperOpen}
          onClose={() => setIsCropperOpen(false)}
          imageSrc={uploadedImage}
          onSave={handleCroppedImage}
        />
      )}
    </div>
  );
}
