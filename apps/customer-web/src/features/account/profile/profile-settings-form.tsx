'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Crown, Save, User } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { InlineLoading } from '@/components/loading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthentication } from '@/features/authentication/session/authentication-context';
import { useUploadAvatar, useUpdateProfile } from '@/features/account/profile/queries';
import { useToast } from '@/hooks/use-toast';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { AvatarCropperModal } from '@/features/account/profile/avatar-cropper-modal';

export function ProfileSettingsForm() {
  const t = useTranslations('settings');
  const tAuth = useTranslations('auth');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const { principal, replacePrincipal, refreshPrincipal } = useAuthentication();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState<string | null>(null);
  const username = usernameDraft ?? principal?.display_name ?? '';
  const email = principal?.email ?? '';
  const avatarMutation = useUploadAvatar();
  const profileMutation = useUpdateProfile();

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

  const handleCroppedImage = (file: File) => {
    avatarMutation.mutate(file, {
      onSuccess: (result) => {
        if (result?.avatar_url) {
          const avatarUrlWithCacheBuster = `${result.avatar_url}?t=${Date.now()}`;

          if (principal) {
            replacePrincipal({ ...principal, avatar_url: avatarUrlWithCacheBuster });
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
          description: userFacingErrorMessage(tErrors, error, t('uploadFailedDesc')),
          variant: 'destructive',
        });
      },
    });
  };

  const handleUpdateProfile = () => {
    profileMutation.mutate(
      { display_name: username !== principal?.display_name ? username : undefined },
      {
        onSuccess: async () => {
          setUsernameDraft(null);
          await refreshPrincipal();
          toast({
            title: t('profileSuccess'),
            description: t('profileUpdated'),
          });
        },
        onError: (error) => {
          toast({
            title: t('profileFailed'),
            description: userFacingErrorMessage(tErrors, error, t('profileFailedDesc')),
            variant: 'destructive',
          });
        },
      }
    );
  };

  return (
    <>
      <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-6 text-xl font-semibold text-gray-950">{t('profile.heading')}</h2>
        <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <Avatar className="h-28 w-28">
                <AvatarImage src={principal?.avatar_url || undefined} />
                <AvatarFallback>
                  <User className="h-10 w-10 text-gray-400" />
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
                className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full bg-white shadow"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarMutation.isPending}
              >
                {avatarMutation.isPending ? (
                  <InlineLoading />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-sm font-medium text-orange-600">
              <Crown className="h-4 w-4" />
              {tCommon('freePlan')}
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="settings-username">{tAuth('usernameLabel')}</Label>
              <Input
                id="settings-username"
                value={username}
                onChange={(event) => setUsernameDraft(event.target.value)}
                className="h-12 bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="settings-email">{tAuth('emailLabel')}</Label>
              <Input
                id="settings-email"
                type="email"
                value={email}
                disabled
                className="h-12 bg-gray-100"
              />
            </div>
            <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row">
              <Button
                className="bg-orange-500 text-white hover:bg-orange-600"
                onClick={handleUpdateProfile}
                disabled={profileMutation.isPending}
              >
                {profileMutation.isPending ? (
                  <InlineLoading />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t('profile.save')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {uploadedImage && (
        <AvatarCropperModal
          isOpen={isCropperOpen}
          onClose={() => setIsCropperOpen(false)}
          imageSrc={uploadedImage}
          onSave={handleCroppedImage}
        />
      )}
    </>
  );
}
