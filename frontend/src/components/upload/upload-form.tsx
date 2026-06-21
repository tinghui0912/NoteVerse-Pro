'use client';

import { useState, type MouseEvent } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Loader2, PlusSquare, UploadCloud, XCircle } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { UploadPreviewDialog } from './upload-preview-dialog';
import type { UploadableFile } from './upload-types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface UploadFormProps {
  files: UploadableFile[];
  scoreName: string;
  difficulty: string;
  isProcessing: boolean;
  isUploading: boolean;
  isSubmitting: boolean;
  taskProgress: number;
  taskError: string | null;
  taskErrorMessage: string;
  onFilesAdded: (files: File[]) => void;
  onClearFiles: () => void;
  onRemoveFile: (index: number) => void;
  onScoreNameChange: (name: string) => void;
  onDifficultyChange: (difficulty: string) => void;
  onSubmit: () => void;
}

function DropzoneContent() {
  const t = useTranslations('upload');
  return (
    <div className="flex flex-col items-center justify-center text-center h-64 p-4">
      <UploadCloud className="mb-4 h-12 w-12 text-muted-foreground" />
      <p className="text-lg font-semibold text-gray-800">{t('dropzoneText')}</p>
      <p className="text-sm text-muted-foreground">{t('dropzoneHint')}</p>
    </div>
  );
}

export function UploadForm(props: UploadFormProps) {
  const t = useTranslations('upload');
  const tCommon = useTranslations('common');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewStartIndex, setPreviewStartIndex] = useState(0);
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: props.onFilesAdded,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.bmp'] },
    noClick: props.files.length > 0,
    noKeyboard: true,
  });

  const reselect = () => {
    props.onClearFiles();
    open();
  };
  const removeFile = (event: MouseEvent, index: number) => {
    event.stopPropagation();
    props.onRemoveFile(index);
  };
  const showPreview = (index: number) => {
    setPreviewStartIndex(index);
    setPreviewOpen(true);
  };

  return (
    <>
      <Card className="w-full bg-white p-8 rounded-2xl shadow-lg">
        <CardContent className="space-y-6 p-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
            <div className="space-y-2">
              <Label htmlFor="score-name">{t('scoreNameLabel')}</Label>
              <Input
                id="score-name"
                placeholder={t('scoreNamePlaceholder')}
                className="h-12 bg-white"
                value={props.scoreName}
                onChange={(event) => props.onScoreNameChange(event.target.value)}
                disabled={props.isProcessing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="score-difficulty">{t('difficultyLabel')}</Label>
              <Select value={props.difficulty} onValueChange={props.onDifficultyChange} disabled={props.isProcessing}>
                <SelectTrigger id="score-difficulty" className="h-12 bg-white">
                  <SelectValue placeholder={t('difficultyLabel')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="difficultyBeginner">{t('difficultyBeginner')}</SelectItem>
                  <SelectItem value="difficultyIntermediate">{t('difficultyIntermediate')}</SelectItem>
                  <SelectItem value="difficultyAdvanced">{t('difficultyAdvanced')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div
            {...getRootProps()}
            className={cn(
              'rounded-2xl border-2 border-dashed p-4 transition-colors cursor-pointer bg-gray-50',
              isDragActive ? 'border-primary bg-orange-50' : 'border-gray-200 hover:border-gray-300',
              props.isProcessing && 'pointer-events-none opacity-50'
            )}
          >
            <input {...getInputProps()} />
            {props.files.length > 0 ? (
              <AlertDialog>
                <AlertDialogTrigger asChild><div><DropzoneContent /></div></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('reselectConfirmTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>{t('reselectConfirmDesc')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={reselect}>{tCommon('confirm')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : <DropzoneContent />}
          </div>

          {props.files.length > 0 && (
            <div className="space-y-4 text-left">
              <h3 className="font-semibold text-gray-800">{t('selectedImages')} ({props.files.length})</h3>
              <div className="flex flex-wrap gap-4">
                {props.files.map((item, index) => (
                  <div
                    key={`${item.file.name}-${index}`}
                    className="relative h-32 w-32 rounded-lg border-2 border-muted overflow-hidden group shadow-md cursor-pointer"
                    onClick={() => showPreview(index)}
                  >
                    <Image src={item.preview} alt={item.file.name} fill unoptimized className="object-cover transition-transform duration-300 group-hover:scale-110" />
                    {item.status === 'uploading' && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="h-6 w-6 text-white animate-spin" />
                      </div>
                    )}
                    {item.status === 'uploaded' && (
                      <div className="absolute top-1 left-1 bg-green-500 text-white text-xs px-1 rounded" aria-label={t('uploadedStatus')}>✓</div>
                    )}
                    {item.status === 'error' && (
                      <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center">
                        <XCircle className="h-6 w-6 text-white" />
                      </div>
                    )}
                    <Button
                      variant="destructive"
                      size="icon"
                      aria-label={t('removeImage', { name: item.file.name })}
                      className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
                      onClick={(event) => removeFile(event, index)}
                      disabled={props.isProcessing}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={open}
                  disabled={props.isProcessing}
                  className="h-32 w-32 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-muted-foreground hover:bg-gray-100 hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <PlusSquare className="h-8 w-8 mb-2" />
                  <span>{t('addMoreImages')}</span>
                </button>
              </div>
            </div>
          )}

          {props.taskError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
              <div className="flex items-center justify-center gap-2 text-red-600 font-medium mb-2">
                <XCircle className="h-5 w-5" />
                {t('processingFailed')}
              </div>
              <p className="text-sm text-red-500">{props.taskErrorMessage}</p>
            </div>
          )}

          <div className="text-center space-y-4">
            <Button
              onClick={props.onSubmit}
              size="lg"
              className="w-full max-w-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold"
              disabled={props.files.length === 0 || props.isProcessing}
            >
              {props.isUploading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('uploading')}</>
                : props.isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('processingProgress', { progress: props.taskProgress })}</>
                  : t('startRecognition')}
            </Button>
          </div>
        </CardContent>
      </Card>
      <UploadPreviewDialog files={props.files} open={previewOpen} startIndex={previewStartIndex} onOpenChange={setPreviewOpen} />
    </>
  );
}
