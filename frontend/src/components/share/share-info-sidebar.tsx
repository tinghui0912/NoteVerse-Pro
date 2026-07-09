'use client';

import { useMutation } from '@tanstack/react-query';
import { Bookmark, ChevronDown, Download, FileImage, FileMusic, Gamepad2, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { Link, routing } from '@/i18n/routing';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { useScoreShell } from '@/components/score-shell/score-shell';
import { useDownload } from '@/hooks/use-download';
import { useToast } from '@/hooks/use-toast';
import { scoreSharingApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { formatApiDateTime, formatKeySignature } from '@/lib/score/metadata-display';
import { SCORE_GENRE_TAGS, taxonomyTagKey } from '@/lib/score/taxonomy';
import type {
  ScoreArtifact,
  ScoreGrantAccess,
  ScoreTaxonomyTag,
} from '@/types/api';

interface ShareInfoSidebarProps {
  artifacts: ScoreArtifact[];
  imageCount: number;
  isAuthenticated: boolean;
  scoreId: string;
  scoreTitle: string;
  shareData: ScoreGrantAccess;
  shareId: string;
  taxonomyTags: ScoreTaxonomyTag[];
}

function fallbackInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'U';
}

export function ShareInfoSidebar(props: ShareInfoSidebarProps) {
  const t = useTranslations('share');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const scoreText = useTranslations('score');
  const practice = useTranslations('practice');
  const scoreStyles = useTranslations('scoreStyles.genre');
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const bookmark = useMutation({ mutationFn: () => scoreSharingApi.bookmark(props.shareId) });
  const { handleDownload } = useDownload({
    mode: 'grant',
    id: props.shareId,
    artifacts: props.artifacts,
  });
  const query = searchParams.toString();
  const localizedSharePath = locale === routing.defaultLocale
    ? `/share/${props.shareId}`
    : `/${locale}/share/${props.shareId}`;
  const returnPath = `${pathname || localizedSharePath}${query ? `?${query}` : ''}`;
  const loginHref = `/auth/login?returnUrl=${encodeURIComponent(returnPath)}`;
  const sharedByName = props.shareData.shared_by?.display_name || t('anonymousUser');
  const genreTags = props.taxonomyTags
    .map((tag) => SCORE_GENRE_TAGS.find((item) => item.category === tag.category && item.code === tag.code))
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
  const { capabilities } = useScoreShell();
  const actionButtonClass = 'h-16 w-full justify-start gap-3 bg-white px-4 text-left';
  const iconClass = 'h-5 w-5 shrink-0';

  const save = () => bookmark.mutate(undefined, {
    onSuccess: () => toast({
      title: t('saveSuccessTitle'),
      description: t('saveSuccessDesc', { scoreName: props.scoreTitle }),
    }),
    onError: (error) => toast({
      title: t('saveFailed'),
      description: error instanceof ApiError
        ? translateErrorCode(errors, error.code, t('saveFailedDesc'))
        : t('saveFailedDesc'),
      variant: 'destructive',
    }),
  });

  return (
    <div className="sticky top-8 space-y-6 lg:col-span-1">
      <Card className="rounded-2xl bg-white shadow-lg">
        <CardHeader>
          <CardTitle>{t('sharedBy')}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Avatar className="h-12 w-12">
            <AvatarImage src={props.shareData.shared_by?.avatar_url ?? undefined} alt={sharedByName} />
            <AvatarFallback>{fallbackInitial(sharedByName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate font-medium">{sharedByName}</p>
            <time className="text-sm text-muted-foreground" dateTime={props.shareData.shared_at}>
              {t('sharedAt', { date: formatApiDateTime(props.shareData.shared_at, locale) })}
            </time>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl bg-white shadow-lg">
        <CardHeader>
          <CardTitle>{scoreText('scoreInfo')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="flex items-center justify-between gap-2">
            <Label className="shrink-0 text-muted-foreground">{scoreText('scoreName')}</Label>
            <span className="flex-1 truncate text-right font-medium">{props.scoreTitle}</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <Label className="shrink-0 pt-1 text-muted-foreground">{scoreText('scoreStyles')}</Label>
            <div className="flex max-w-[70%] flex-wrap justify-end gap-2">
              {genreTags.length > 0 ? genreTags.map((tag) => (
                <span
                  key={taxonomyTagKey(tag)}
                  className="rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700"
                >
                  {scoreStyles(tag.code)}
                </span>
              )) : <span className="text-sm text-muted-foreground">{scoreText('noStyleTags')}</span>}
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{scoreText('keySignature')}</span>
            <span className="font-medium">
              {formatKeySignature(
                props.shareData.metadata?.primary_key_fifths,
                props.shareData.metadata?.primary_mode
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{scoreText('measureCount')}</span>
            <span className="font-medium">{props.shareData.metadata?.measure_count ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">{scoreText('totalPages')}</span>
            <span className="font-medium">{scoreText('pageCount', { count: props.imageCount })}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl bg-white shadow-lg">
        <CardHeader>
          <CardTitle>{scoreText('actionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={actionButtonClass} disabled={!capabilities.can_download}>
                <Download className={iconClass} />
                <span className="flex min-w-0 flex-1 items-center gap-1">
                  <span className="truncate">{common('download')}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => handleDownload('image')}>
                <FileImage className="mr-2 h-4 w-4" />
                {scoreText('downloadImage')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload('xml')}>
                <FileMusic className="mr-2 h-4 w-4" />
                {scoreText('downloadMusicXML')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {capabilities.can_practice ? (
            <Button asChild variant="outline" className={actionButtonClass}>
              <Link href={`/score/${props.scoreId}/practice?shareToken=${props.shareId}`}>
                <Gamepad2 className={iconClass} />
                <span className="truncate">{practice('mode')}</span>
              </Link>
            </Button>
          ) : null}

          {props.isAuthenticated ? (
            <Button variant="outline" className={actionButtonClass} onClick={save} disabled={bookmark.isPending}>
              {bookmark.isPending ? <Loader2 className={`${iconClass} animate-spin`} /> : <Bookmark className={iconClass} />}
              <span className="truncate">{t('saveToLibrary')}</span>
            </Button>
          ) : (
            <Button asChild variant="outline" className={actionButtonClass}>
              <Link href={loginHref}>
                <Bookmark className={iconClass} />
                <span className="truncate">{t('saveToLibrary')}</span>
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
