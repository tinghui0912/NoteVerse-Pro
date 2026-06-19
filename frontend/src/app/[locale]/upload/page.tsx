'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UploadCloud, XCircle, PlusSquare, X, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, useEffect, useRef, Suspense } from 'react';
import { useDropzone } from 'react-dropzone';
import Image from 'next/image';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
} from "@/components/ui/alert-dialog"
import { cn } from '@/lib/utils';
import { Footer } from '@/components/layout/footer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { filesApi, tasksApi } from '@/lib/api';
import { useSubmitBatch, useTaskDetail } from '@/hooks/queries/use-task-queries';
import { ApiError } from '@/lib/api-client';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { useToast } from '@/hooks/use-toast';

// 鎵╁睍 File 绫诲瀷浠ュ寘鍚瑙堝拰涓婁紶鐘舵€?
interface UploadableFile {
  file: File;
  preview: string;
  fileId?: string; // 涓婁紶鍚庣殑鏂囦欢 ID (SHA256)
  sha256?: string; // 鍘嗗彶浠诲姟鐨勬枃浠跺搱甯岋紙鍙鐢級
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  error?: string;
}

interface RestoredUploadInfo {
  original_filename?: string;
  sha256?: string;
}

interface RestorableTaskData {
  upload_ids?: RestoredUploadInfo[];
}

const TASK_POLL_INTERVAL_MS = 2000;
const TASK_WAIT_TIMEOUT_MS = 18 * 60 * 1000;

function createSubmissionIdempotencyKey() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function UploadPageContent() {
  const t = useTranslations('upload');
  const tCommon = useTranslations('common');
  const router = useRouter();
  const { toast } = useToast();

  const [files, setFiles] = useState<UploadableFile[]>([]);
  const filesRef = useRef<UploadableFile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStartIndex, setModalStartIndex] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 璺熻釜缁勪欢鏄惁鎸傝浇锛岀敤浜庡仠姝㈣疆璇?
  const isMountedRef = useRef(true);
  const submissionIdempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  const [scoreName, setScoreName] = useState('');
  const [difficulty, setDifficulty] = useState('difficultyIntermediate');
  // 浠诲姟杞鐘舵€?
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskError, setTaskError] = useState<string | null>(null); // 浠诲姟閿欒淇℃伅
  const taskErrorMessage = taskError
    ? (t.has(taskError as never) ? t(taskError as never) : taskError)
    : '';
  const [pollInterval, setPollInterval] = useState<number | false>(false);
  const [pollStartTime, setPollStartTime] = useState<number>(0);

  const { data: statusResponse } = useTaskDetail(currentTaskId || '', {
    enabled: !!currentTaskId && pollInterval !== false,
    refetchInterval: pollInterval
  });
  const submitBatchMutation = useSubmitBatch();

  // 杞鐘舵€佺洃鍚?
  useEffect(() => {
    if (!statusResponse?.data || !currentTaskId) return;

    if (Date.now() - pollStartTime > TASK_WAIT_TIMEOUT_MS) {
      toast({
        title: t('processingTimeout'),
        description: t('processingTimeoutDesc'),
        variant: 'destructive',
      });
      setTaskError(t('processingTimeoutDesc'));
      setIsSubmitting(false);
      setCurrentTaskId(null);
      setPollInterval(false);
      return;
    }

    const data = statusResponse.data;
    setTaskProgress(data.progress || 0);

    const state = String(data.state).toUpperCase();

    if (state === 'PENDING_REVIEW' || state === 'SUCCESS') {
      setIsSubmitting(false);
      setCurrentTaskId(null);
      setPollInterval(false);
      setTaskProgress(0);

      files.forEach(f => URL.revokeObjectURL(f.preview));
      setFiles([]);

      const redirectPath = state === 'PENDING_REVIEW' ? `/review/${currentTaskId}` : `/results/${currentTaskId}`;
      router.push(redirectPath);
    } else if (state === 'FAILURE') {
      setTaskError(data.error || t('taskProcessingFailed'));
      setIsSubmitting(false);
      setCurrentTaskId(null);
      setPollInterval(false);
    }
  }, [statusResponse?.data, currentTaskId, files, router, t, pollStartTime, toast]);

  // URL 鍙傛暟
  const searchParams = useSearchParams();
  const urlTaskId = searchParams.get('task_id');
  const hasRestoredRef = useRef(false); // 闃叉閲嶅鎭㈠

  const onDrop = useCallback((acceptedFiles: File[]) => {
    submissionIdempotencyKeyRef.current = null;
    const newFiles: UploadableFile[] = acceptedFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      status: 'pending',
    }));
    setFiles(prevFiles => [...prevFiles, ...newFiles]);
  }, []);

  const handleReselect = (openFileDialog: () => void) => {
    submissionIdempotencyKeyRef.current = null;
    files.forEach(f => URL.revokeObjectURL(f.preview));
    setFiles([]);
    openFileDialog();
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.bmp'] },
    noClick: files.length > 0, // 鏈夋枃浠舵椂绂佺敤鐐瑰嚮锛堜娇鐢?AlertDialog锛夛紝鏃犳枃浠舵椂鍚敤鐐瑰嚮
    noKeyboard: true,
  });

  const removeFile = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    submissionIdempotencyKeyRef.current = null;
    setFiles(prevFiles => {
      const newFiles = [...prevFiles];
      const removedFile = newFiles.splice(index, 1);
      if (removedFile[0]) {
        URL.revokeObjectURL(removedFile[0].preview);
      }
      return newFiles;
    });
  };

  /**
   * 涓婁紶鏂囦欢骞舵彁浜や换鍔?   */
  const handleRecognition = async () => {
    if (files.length === 0) return;

    // 閲嶇疆涔嬪墠鐨勪换鍔＄姸鎬?    setCurrentTaskId(null);
    setTaskProgress(0);
    setTaskError(null); // 娓呴櫎閿欒鐘舵€?
    setIsUploading(true);

    try {
      // 绗竴姝ワ細涓婁紶鎵€鏈夋枃浠讹紙鏈?uploadId 鐨勭洿鎺ュ鐢紝娌℃湁鐨勯渶瑕佷笂浼狅級
      const uploadedFileIds: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const currentFile = files[i];

        // 鏈?sha256 鐨勬枃浠跺彲浠ョ洿鎺ュ鐢?
        if (currentFile.sha256) {
          uploadedFileIds.push(currentFile.sha256);
          continue;
        }

        // 宸茬粡涓婁紶杩囩殑鏂囦欢锛堟湰娆′細璇濅笂浼犵殑锛?
        if (currentFile.status === 'uploaded' && currentFile.fileId) {
          uploadedFileIds.push(currentFile.fileId);
          continue;
        }

        // 鏇存柊鐘舵€佷负 uploading
        setFiles(prev => prev.map((f, idx) =>
          idx === i ? { ...f, status: 'uploading' as const } : f
        ));

        try {
          const response = await filesApi.uploadFile(currentFile.file);
          if (response.data?.file_id) {
            uploadedFileIds.push(response.data.file_id);

            // 鏇存柊鐘舵€佷负 uploaded
            setFiles(prev => prev.map((f, idx) =>
              idx === i ? { ...f, status: 'uploaded' as const, fileId: response.data?.file_id } : f
            ));
          }
        } catch (err) {
          // 鏇存柊鐘舵€佷负 error
          const errorMessage = err instanceof ApiError ? err.message : tCommon('operationFailed');
          setFiles(prev => prev.map((f, idx) =>
            idx === i ? { ...f, status: 'error' as const, error: errorMessage } : f
          ));
          throw new Error(t('uploadFailedFile', { name: '{name}' }).replace('{name}', currentFile.file.name));
        }
      }

      setIsUploading(false);
      setIsSubmitting(true);
      if (!submissionIdempotencyKeyRef.current) {
        submissionIdempotencyKeyRef.current = createSubmissionIdempotencyKey();
      }

      // 绗簩姝ワ細鎻愪氦澶勭悊浠诲姟
      const response = await submitBatchMutation.mutateAsync({
        fileIds: uploadedFileIds,
        idempotencyKey: submissionIdempotencyKeyRef.current,
        options: {
          title: scoreName || undefined,
          difficulty,
        }
      });

      if (response.data?.task_id) {
        submissionIdempotencyKeyRef.current = null;
        const taskId = response.data.task_id;
        setCurrentTaskId(taskId);
        setTaskProgress(5);
        setPollStartTime(Date.now());
        setPollInterval(TASK_POLL_INTERVAL_MS);
        toast({
          title: t('taskStarted'),
          description: t('taskStartedDesc'),
        });
      }
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : (err as Error).message || t('processingFailed');
      toast({
        title: t('submitFailed'),
        description: errorMessage,
        variant: 'destructive',
      });
      setIsUploading(false);
      setIsSubmitting(false);
    }
  };

  const handleOpenModal = (index: number) => {
    setModalStartIndex(index);
    setIsModalOpen(true);
  }

  useEffect(() => {
    if (!carouselApi) {
      return
    }
    setCurrentSlide(carouselApi.selectedScrollSnap())
    carouselApi.on("select", () => {
      setCurrentSlide(carouselApi.selectedScrollSnap())
    })
  }, [carouselApi])

  // 浠?URL 鍙傛暟鎭㈠浠诲姟鐘舵€?
  useEffect(() => {
    if (!urlTaskId || hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    // 鎭㈠浠诲姟鐘舵€?
    const restoreTask = async () => {
      try {
        const response = await tasksApi.getTaskDetails(urlTaskId);
        const data = response.data;

        if (!data) return;

        const state = String(data.state).toUpperCase();

        // 鎭㈠涔愯氨鍚嶇О鍜岄毦搴?
        if (data.title) {
          setScoreName(data.title);
        }
        if (data.difficulty) {
          setDifficulty(data.difficulty);
        }

        // 鎭㈠鍘熷鍥剧墖锛堜娇鐢?upload_ids 杩斿洖鐨勬暟鎹級
        const originalImages = data.files?.original_image;
        const uploadIds = (data as RestorableTaskData).upload_ids || [];

        if (originalImages && originalImages.length > 0) {
          const restoredFiles: UploadableFile[] = [];

          for (let i = 0; i < originalImages.length; i++) {
            const imgUrl = await fetchAuthenticatedImage(urlTaskId, 'original_image', i + 1);
            if (imgUrl) {
              // 浠?upload_ids 涓幏鍙栧搴旂殑 upload_id
              const uploadInfo = uploadIds[i];
              const originalImage = originalImages[i];
              const fallbackName = originalImage.filename || originalImage.storage_key?.split('/').pop();
              const fileName = uploadInfo?.original_filename || fallbackName || `image_${i + 1}.png`;

              restoredFiles.push({
                file: new File([], fileName, { type: 'image/png' }),
                preview: imgUrl,
                status: 'uploaded', // 鏍囪涓哄凡涓婁紶锛堝洜涓烘湁 sha256 鍙鐢級
                sha256: uploadInfo?.sha256, // 淇濆瓨 sha256 鐢ㄤ簬澶嶇敤
                fileId: undefined,
              });
            }
          }

          if (restoredFiles.length > 0) {
            setFiles(restoredFiles);
          }
        }

        if (state === 'PENDING' || state === 'PROGRESS') {
          // 澶勭悊涓紝鎭㈠杞
          setCurrentTaskId(urlTaskId);
          setIsSubmitting(true);
          setTaskProgress(data.progress || 0);
          setPollStartTime(Date.now());
          setPollInterval(TASK_POLL_INTERVAL_MS);
        } else if (state === 'FAILURE') {
          // 澶辫触锛屾樉绀洪敊璇俊鎭?          setCurrentTaskId(urlTaskId);
          setTaskError(data.error || t('processingFailed'));
          setTaskProgress(0);
        }
        // SUCCESS 鐘舵€佷笉澶勭悊锛岃鐢ㄦ埛閲嶆柊涓婁紶
      } catch (err) {
        console.error('鎭㈠浠诲姟鐘舵€佸け璐?', err);
      }
    };

    restoreTask();
  }, [t, urlTaskId]);


  useEffect(() => {
    return () => {
      if (filesRef.current.length > 0) {
        filesRef.current.forEach(f => URL.revokeObjectURL(f.preview));
      }
    };
  }, []);

  const isProcessing = isUploading || isSubmitting;

  const previews = files.map((f, index) => (
    <div
      key={f.file.name + index}
      className="relative h-32 w-32 rounded-lg border-2 border-muted overflow-hidden group shadow-md cursor-pointer"
      onClick={() => handleOpenModal(index)}
    >
      <Image
        src={f.preview}
        alt={f.file.name}
        fill
        unoptimized
        className="object-cover transition-transform duration-300 group-hover:scale-110"
      />
      {/* 鐘舵€佹寚绀哄櫒 */}
      {f.status === 'uploading' && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-white animate-spin" />
        </div>
      )}
      {f.status === 'uploaded' && (
        <div className="absolute top-1 left-1 bg-green-500 text-white text-xs px-1 rounded">
          鉁?        </div>
      )}
      {f.status === 'error' && (
        <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center">
          <XCircle className="h-6 w-6 text-white" />
        </div>
      )}
      <Button
        variant="destructive"
        size="icon"
        className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={(e) => removeFile(e, index)}
        disabled={isProcessing}
      >
        <XCircle className="h-4 w-4" />
      </Button>
    </div>
  ));

  const DropzoneContent = () => (
    <div className="flex flex-col items-center justify-center text-center h-64 p-4">
      <UploadCloud className="mb-4 h-12 w-12 text-muted-foreground" />
      <p className="text-lg font-semibold text-gray-800">{t('dropzoneText')}</p>
      <p className="text-sm text-muted-foreground">{t('dropzoneHint')}</p>
    </div>
  );

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-16">
          <Card className="w-full bg-white p-8 rounded-2xl shadow-lg">
            <CardContent className="space-y-6 p-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                <div className="space-y-2">
                  <Label htmlFor="score-name">{t('scoreNameLabel')}</Label>
                  <Input
                    id="score-name"
                    placeholder={t('scoreNamePlaceholder')}
                    className="h-12 bg-white"
                    value={scoreName}
                    onChange={(e) => setScoreName(e.target.value)}
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="score-difficulty">{t('difficultyLabel')}</Label>
                  <Select value={difficulty} onValueChange={setDifficulty} disabled={isProcessing}>
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
                {...getRootProps({
                  onDragOver: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  },
                  onDragEnter: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  },
                })}
                className={cn(
                  'rounded-2xl border-2 border-dashed p-4 transition-colors cursor-pointer bg-gray-50',
                  isDragActive ? 'border-primary bg-orange-50' : 'border-gray-200 hover:border-gray-300',
                  isProcessing && 'pointer-events-none opacity-50'
                )}
              >
                <input {...getInputProps()} />
                {files.length > 0 ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <div>
                        <DropzoneContent />
                      </div>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('reselectConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('reselectConfirmDesc')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleReselect(open)}>
                          {tCommon('confirm')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <DropzoneContent />
                )}
              </div>

              {files.length > 0 && (
                <div className="space-y-4 text-left">
                  <h3 className="font-semibold text-gray-800">{t('selectedImages')} ({files.length})</h3>
                  <div className="flex flex-wrap gap-4">
                    {previews}
                    <button
                      onClick={open}
                      disabled={isProcessing}
                      className="h-32 w-32 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-muted-foreground hover:bg-gray-100 hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <PlusSquare className="h-8 w-8 mb-2" />
                      <span>{t('addMoreImages')}</span>
                    </button>
                  </div>
                </div>
              )}
              {/* 浠诲姟閿欒淇℃伅鏄剧ず */}
              {taskError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                  <div className="flex items-center justify-center gap-2 text-red-600 font-medium mb-2">
                    <XCircle className="h-5 w-5" />
                    {t('processingFailed')}
                  </div>
                  <p className="text-sm text-red-500">{taskErrorMessage}</p>
                </div>
              )}



              <div className='text-center space-y-4'>
                <Button
                  onClick={handleRecognition}
                  size="lg"
                  className="w-full max-w-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                  disabled={files.length === 0 || isProcessing}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('uploading')}
                    </>
                  ) : isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('processingProgress', { progress: '{progress}' }).replace('{progress}', String(taskProgress))}
                    </>
                  ) : (
                    t('startRecognition')
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="w-[90vw] max-w-5xl flex flex-col p-2 sm:p-4">
          <DialogHeader className="flex-row items-center justify-between space-y-0 p-2 sm:pb-2">
            <DialogTitle className="truncate text-sm sm:text-base">{files[currentSlide]?.file.name}</DialogTitle>
            <DialogClose className="relative rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </DialogHeader>
          <Carousel setApi={setCarouselApi} opts={{ startIndex: modalStartIndex, loop: true }} className="w-full relative">
            <CarouselContent>
              {files.map((f, index) => (
                <CarouselItem key={index}>
                  <div className="relative w-full h-[80vh]">
                    <Image
                      src={f.preview}
                      alt={f.file.name}
                      fill
                      unoptimized
                      className="object-contain rounded-md"
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-2" />
            <CarouselNext className="right-2" />
          </Carousel>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>}>
      <UploadPageContent />
    </Suspense>
  );
}
