'use client';

import { useMemo, useState } from 'react';
import { Copy, Trash2, UserPlus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';
import { InlineLoading } from '@/components/loading';
import { SectionLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  useCreateScoreInvite,
  useDeleteScoreInvite,
  useRemoveScoreMember,
  useRevokeScoreInvite,
  useScoreInvites,
  useScoreMembers,
  useUpdateScoreMember,
} from '@/hooks/queries/use-score-queries';
import { useToast } from '@/hooks/use-toast';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { formatApiDateTime } from '@/lib/date-time';
import type { MembershipRole } from '@/types/api';

function absoluteInviteUrl(token: string, locale: string) {
  const path = locale === routing.defaultLocale ? `/invite/${token}` : `/${locale}/invite/${token}`;
  return `${window.location.origin}${path}`;
}

function isEmailLike(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function ScoreCollaborationPanel({
  scoreTitle,
  scoreId,
}: {
  scoreTitle: string;
  scoreId: string;
}) {
  const t = useTranslations('scoreCollaboration');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const { toast } = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('EDITOR');
  const [createdTokens, setCreatedTokens] = useState<Record<string, string>>({});
  const invitesQuery = useScoreInvites(scoreId);
  const membersQuery = useScoreMembers(scoreId);
  const createInvite = useCreateScoreInvite(scoreId);
  const revokeInvite = useRevokeScoreInvite(scoreId);
  const deleteInvite = useDeleteScoreInvite(scoreId);
  const updateMember = useUpdateScoreMember(scoreId);
  const removeMember = useRemoveScoreMember(scoreId);
  const invites = useMemo(() => invitesQuery.data?.data ?? [], [invitesQuery.data]);
  const members = useMemo(() => membersQuery.data?.data ?? [], [membersQuery.data]);

  const copyInvite = async (token: string) => {
    try {
      await navigator.clipboard.writeText(absoluteInviteUrl(token, locale));
      toast({ title: t('copied'), description: t('copiedDescription') });
    } catch {
      toast({ title: t('copyFailed'), description: t('copyFailedDescription'), variant: 'destructive' });
    }
  };

  const submitInvite = () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      toast({
        title: t('emailRequired'),
        description: t('emailRequiredDescription'),
        variant: 'destructive',
      });
      return;
    }
    if (!isEmailLike(normalizedEmail)) {
      toast({
        title: t('emailInvalid'),
        description: t('emailInvalidDescription'),
        variant: 'destructive',
      });
      return;
    }

    createInvite.mutate(
      {
        email: normalizedEmail,
        role,
        expires_at: null,
        locale: locale === 'en' ? 'en' : 'zh',
      },
      {
        onSuccess: (response) => {
          const invite = response.data;
          if (invite) {
            setCreatedTokens((current) => ({ ...current, [invite.invite_id]: invite.token }));
            setEmail('');
          }
          toast({ title: t('inviteCreated'), description: t('inviteCreatedDescription') });
        },
        onError: (error) => {
          const validationFailed = error instanceof ApiError && error.status === 422;
          toast({
            title: validationFailed ? t('emailInvalid') : t('inviteFailed'),
            description: validationFailed
              ? t('emailInvalidDescription')
              : error instanceof ApiError
                ? translateErrorCode(errors, error.code, t('inviteFailedDescription'))
                : t('inviteFailedDescription'),
            variant: 'destructive',
          });
        },
      }
    );
  };

  const busy =
    createInvite.isPending ||
    revokeInvite.isPending ||
    deleteInvite.isPending ||
    updateMember.isPending ||
    removeMember.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('scoreName', { name: scoreTitle })}</p>
      </div>

          <section className="space-y-3">
            <h3 className="font-semibold">{t('inviteSection')}</h3>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_auto]">
              <div className="space-y-2">
                <Label htmlFor="collaboration-email">{t('email')}</Label>
                <Input
                  id="collaboration-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder={t('emailPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label>{t('role')}</Label>
                <Select value={role} onValueChange={(value) => setRole(value as MembershipRole)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EDITOR">{t('editor')}</SelectItem>
                    <SelectItem value="VIEWER">{t('viewer')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={submitInvite} disabled={busy || !email.trim()}>
                  {createInvite.isPending ? <InlineLoading /> : <UserPlus className="h-4 w-4" />}
                  {t('createInvite')}
                </Button>
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <h3 className="font-semibold">{t('members')}</h3>
            {membersQuery.isLoading ? (
              <SectionLoading label={common('loading')} className="min-h-16" />
            ) : members.length ? (
              <div className="divide-y rounded-lg border">
                {members.map((member) => (
                  <div key={member.membership_id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-center">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{member.display_name || member.email}</p>
                      <p className="truncate text-sm text-muted-foreground">{member.email}</p>
                    </div>
                    <Select
                      value={member.role}
                      disabled={busy || Boolean(member.revoked_at)}
                      onValueChange={(nextRole) => updateMember.mutate({
                        membershipId: member.membership_id,
                        role: nextRole as MembershipRole,
                      })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EDITOR">{t('editor')}</SelectItem>
                        <SelectItem value="VIEWER">{t('viewer')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || Boolean(member.revoked_at)}
                      onClick={() => removeMember.mutate(member.membership_id)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t('remove')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={t('noMembers')} className="min-h-0 rounded-lg border border-dashed p-5" />
            )}
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold">{t('pendingInvites')}</h3>
            {invitesQuery.isLoading ? (
              <SectionLoading label={common('loading')} className="min-h-16" />
            ) : invites.length ? (
              <ScrollArea className="max-h-64">
                <div className="divide-y rounded-lg border">
                  {invites.map((invite) => {
                    const token = createdTokens[invite.invite_id];
                    return (
                      <div key={invite.invite_id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-center">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{invite.email}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            {t(`status.${invite.status.toLowerCase()}`)} · {t(invite.role === 'EDITOR' ? 'editor' : 'viewer')}
                            {invite.expires_at ? ` · ${formatApiDateTime(invite.expires_at, locale)}` : ''}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" disabled={!token} onClick={() => token && void copyInvite(token)}>
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          {t('copy')}
                        </Button>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy || invite.status !== 'PENDING'}
                            onClick={() => revokeInvite.mutate(invite.invite_id)}
                          >
                            {t('revoke')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy}
                            onClick={() => deleteInvite.mutate(invite.invite_id)}
                          >
                            {t('delete')}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            ) : (
              <EmptyState title={t('noInvites')} className="min-h-0 rounded-lg border border-dashed p-5" />
            )}
          </section>

    </div>
  );
}
