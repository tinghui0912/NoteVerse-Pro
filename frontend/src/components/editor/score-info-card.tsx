
'use client';

import { useTranslations } from 'next-intl';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useScoreData, useMetadataEditor } from '@/contexts/editor-provider';

export function ScoreInfoCard() {
  const t = useTranslations('editor');
  const tResults = useTranslations('results');
  const { scoreData } = useScoreData();
  const {
    updateKeySignature,
    updateTimeSignature,
    updateTempo,
    updateScoreMainTitle,
    updateScoreSubtitle,
    updateScoreCopyright,
    updateScoreComposer,
    updateScoreLyricist,
  } = useMetadataEditor();

  return (
    <Card className="bg-white rounded-2xl shadow-lg">
      <CardHeader>
        <CardTitle>{tResults('scoreInfo')}</CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2">
            <Label htmlFor="main-title">{t('mainTitleLabel')}</Label>
            <Input
              key={`main-title-${scoreData?.mainTitle || ''}`}
              id="main-title"
              defaultValue={scoreData?.mainTitle || ''}
              className="bg-white"
              onBlur={(e) => updateScoreMainTitle(e.currentTarget.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="subtitle">{t('subtitleLabel')}</Label>
            <Input
              key={`subtitle-${scoreData?.subtitle || ''}`}
              id="subtitle"
              defaultValue={scoreData?.subtitle || ''}
              className="bg-white"
              onBlur={(e) => updateScoreSubtitle(e.currentTarget.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="composer">{t('composerLabel')}</Label>
            <Input
              key={`composer-${scoreData?.composer || ''}`}
              id="composer"
              defaultValue={scoreData?.composer || ''}
              className="bg-white"
              onBlur={(e) => updateScoreComposer(e.currentTarget.value)}
            />
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="lyricist">{t('lyricistLabel')}</Label>
            <Input
              key={`lyricist-${scoreData?.lyricist || ''}`}
              id="lyricist"
              defaultValue={scoreData?.lyricist || ''}
              className="bg-white"
              onBlur={(e) => updateScoreLyricist(e.currentTarget.value)}
            />
          </div>
          <div className="md:col-span-4">
            <Label htmlFor="copyright">{t('copyrightLabel')}</Label>
            <Textarea
              key={`copyright-${scoreData?.copyright || ''}`}
              id="copyright"
              defaultValue={scoreData?.copyright || ''}
              className="bg-white"
              onBlur={(e) => updateScoreCopyright(e.currentTarget.value)}
            />
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <Label htmlFor="time-signature">{t('timeSignatureLabel')}</Label>
            <Select
              value={scoreData?.timeSignature || '4/4'}
              onValueChange={updateTimeSignature}
            >
              <SelectTrigger id="time-signature" className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4/4">4/4</SelectItem>
                <SelectItem value="3/4">3/4</SelectItem>
                <SelectItem value="2/4">2/4</SelectItem>
                <SelectItem value="2/2">2/2</SelectItem>
                <SelectItem value="6/8">6/8</SelectItem>
                <SelectItem value="9/8">9/8</SelectItem>
                <SelectItem value="12/8">12/8</SelectItem>
                <SelectItem value="3/8">3/8</SelectItem>
                <SelectItem value="5/4">5/4</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="key-signature">{t('keySignatureLabel')}</Label>
            <Select
              value={scoreData?.keySignature || '0'}
              onValueChange={updateKeySignature}
            >
              <SelectTrigger id="key-signature" className="bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-7">C♭ (7♭)</SelectItem>
                <SelectItem value="-6">G♭ (6♭)</SelectItem>
                <SelectItem value="-5">D♭ (5♭)</SelectItem>
                <SelectItem value="-4">A♭ (4♭)</SelectItem>
                <SelectItem value="-3">E♭ (3♭)</SelectItem>
                <SelectItem value="-2">B♭ (2♭)</SelectItem>
                <SelectItem value="-1">F (1♭)</SelectItem>
                <SelectItem value="0">C</SelectItem>
                <SelectItem value="1">G (1♯)</SelectItem>
                <SelectItem value="2">D (2♯)</SelectItem>
                <SelectItem value="3">A (3♯)</SelectItem>
                <SelectItem value="4">E (4♯)</SelectItem>
                <SelectItem value="5">B (5♯)</SelectItem>
                <SelectItem value="6">F♯ (6♯)</SelectItem>
                <SelectItem value="7">C♯ (7♯)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label htmlFor="tempo">{t('tempoLabel')}</Label>
            <Input id="tempo" type="number" value={scoreData?.tempo || ''} className="bg-white" onChange={(e) => updateTempo(e.target.value)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
